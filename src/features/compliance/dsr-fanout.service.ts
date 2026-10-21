import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import {
    ComplianceAuditLoggedEvent,
    ComplianceEvents,
    DsrReceiptStatus,
    DsrRequestProps,
    DsrStatus,
    ErasureCompletedEvent,
    ErasureReceiptSummary
} from '@domains/compliance';
import { OperatorErasureService } from '@app/features/users/operator-erasure.service';

import { ERASURE_TARGETS, ErasureTarget } from './dsr-targets';
import { ErasureClient, ErasureSubject, TargetReceipt } from './erasure.client';

/** A receipt in one of these states is an answer; the rest are re-asked on the next run. */
const ANSWERED = [DsrReceiptStatus.COMPLETED, DsrReceiptStatus.PARTIAL] as string[];

export interface FanOutOutcome {
    dsrId: string;
    answered: number;
    outstanding: string[];
}

/**
 * Erasure fan-out (Product Spec R-CPL-02): "each service anonymises its share and returns a receipt;
 * erasure.completed carries all receipts".
 *
 * On BullMQ with the state in `dsr_receipts`, not on Temporal. R-CPL-02 names a Temporal workflow and
 * this service has no Temporal client, no worker and no dependency on it — the three `temporal_*`
 * columns in the schema are written from an inbound DTO, never by a workflow here. What the fan-out
 * actually needs from a workflow engine is resumability, and a unique `(dsr_request_id, service_name)`
 * gives that directly: a run asks only the targets that have not answered, so a crash, a retry and a
 * later sweep all converge on the same six receipts. Decided 2026-10-21; see NOTE.md §V5.16.
 */
@Injectable()
export class DsrFanOutService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly erasure: ErasureClient,
        private readonly operators: OperatorErasureService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(DsrFanOutService.name);
    }

    /**
     * Asks every target that still owes an answer, records what comes back, and completes the request
     * once all six have answered. Safe to run again at any point — that is the whole resumption story.
     */
    async run(dsrId: string, tenantId: string): Promise<FanOutOutcome> {
        const request = await this.load(dsrId, tenantId);
        const answered = new Set((request.receipts ?? []).filter((receipt) => ANSWERED.includes(receipt.status)).map((r) => r.serviceName));

        if (answered.size < ERASURE_TARGETS.length && request.status !== DsrStatus.IN_PROGRESS) {
            await this.prisma.dsrRequest.update({ where: { id: dsrId }, data: { status: DsrStatus.IN_PROGRESS } });
        }

        for (const target of ERASURE_TARGETS.filter((candidate) => !answered.has(candidate.serviceName))) {
            const receipt = await this.ask(target, request);
            await this.record(request, target, receipt);
            if (ANSWERED.includes(receipt.status)) {
                answered.add(target.serviceName);
            }
        }

        const outstanding = ERASURE_TARGETS.filter((target) => !answered.has(target.serviceName)).map((target) => target.serviceName);
        if (outstanding.length === 0) {
            await this.complete(dsrId, tenantId);
        }
        this.logger.log('Erasure fan-out run finished', { dsrId, answered: answered.size, outstanding });
        return { dsrId, answered: answered.size, outstanding };
    }

    /** Erasures still waiting on a target, oldest deadline first — what the sweeper re-runs. */
    async findUnfinished(limit: number): Promise<Array<{ id: string; tenantId: string }>> {
        return this.prisma.dsrRequest.findMany({
            where: { requestType: 'erasure', status: { in: [DsrStatus.PENDING, DsrStatus.IN_PROGRESS] } },
            select: { id: true, tenantId: true },
            orderBy: { dueAt: 'asc' },
            take: limit
        });
    }

    private async load(dsrId: string, tenantId: string): Promise<DsrRequestProps> {
        const row = (await this.prisma.dsrRequest.findFirst({
            where: { id: dsrId, tenantId },
            include: { receipts: true }
        })) as DsrRequestProps | null;
        if (!row) {
            throw new Error(`Data-subject request not found: ${dsrId}`);
        }
        return row;
    }

    /** Identity's share is this service's own handler, called in-process; the other five over HTTP. */
    private async ask(target: ErasureTarget, request: DsrRequestProps): Promise<TargetReceipt> {
        if (target.configKey) {
            return this.erasure.erase(target, toErasureSubject(request));
        }
        if (!request.subjectEmailHash) {
            // An operator record is only ever matched by email hash: `subject_id` and
            // `subject_external_id` name a participant or invitee, which is a different id space.
            return {
                status: DsrReceiptStatus.COMPLETED,
                receipt: { service: target.serviceName, share: target.share, status: 'not_found', reason: 'subject carries no email hash' },
                retainedUnderObligation: false
            };
        }
        const receipt = await this.operators.erase({ dsrId: request.id, subjectEmailHash: request.subjectEmailHash });
        return {
            status: receipt.status === 'blocked' ? DsrReceiptStatus.FAILED : DsrReceiptStatus.COMPLETED,
            receipt: { ...receipt, share: target.share } as unknown as Record<string, unknown>,
            retainedUnderObligation: receipt.retained.length > 0
        };
    }

    /** The unique `(dsr_request_id, service_name)` is what makes a re-delivered answer an update. */
    private async record(request: DsrRequestProps, target: ErasureTarget, receipt: TargetReceipt): Promise<void> {
        const data = {
            status: receipt.status,
            receipt: receipt.receipt as Prisma.InputJsonValue,
            retainedUnderObligation: receipt.retainedUnderObligation,
            receivedAt: new Date()
        };
        await this.prisma.dsrReceipt.upsert({
            where: { dsrRequestId_serviceName: { dsrRequestId: request.id, serviceName: target.serviceName } },
            create: { dsrRequestId: request.id, tenantId: request.tenantId, serviceName: target.serviceName, ...data },
            update: data
        });
    }

    /**
     * R-CPL-02's last two steps: `erasure.completed` carrying every receipt, then `audit.logged`. Both
     * are emitted inside the transaction that stamps `completed_at`, so neither can describe a request
     * that did not finish.
     */
    private async complete(dsrId: string, tenantId: string): Promise<void> {
        const completedAt = new Date();
        await this.prisma.$transaction(async (tx) => {
            const row = (await tx.dsrRequest.update({
                where: { id: dsrId },
                data: { status: DsrStatus.COMPLETED, completedAt },
                include: { receipts: { orderBy: { serviceName: 'asc' } } }
            })) as DsrRequestProps;
            const receipts: ErasureReceiptSummary[] = (row.receipts ?? []).map((receipt) => ({
                service: receipt.serviceName,
                status: receipt.status,
                retained_under_obligation: receipt.retainedUnderObligation
            }));
            const subject = { subjectEmailHash: row.subjectEmailHash, subjectExternalId: row.subjectExternalId };
            this.txEventEmitter.emitAfterCommit(
                ComplianceEvents.ERASURE_COMPLETED,
                new ErasureCompletedEvent(dsrId, tenantId, { ...subject, completedAt, receipts })
            );
            this.txEventEmitter.emitAfterCommit(
                ComplianceEvents.AUDIT_LOGGED,
                new ComplianceAuditLoggedEvent(dsrId, tenantId, {
                    action: ComplianceEvents.ERASURE_COMPLETED,
                    subjectEmailHash: row.subjectEmailHash,
                    receiptCount: receipts.length,
                    recordUrl: `/api/v1/dsr/${dsrId}`
                })
            );
        });
        this.logger.log('Erasure completed across every target', { dsrId, completedAt });
    }
}

/** `subject_id` is a participant id, which is what the handler contract calls `participant_id`. */
function toErasureSubject(request: DsrRequestProps): ErasureSubject {
    return {
        dsrId: request.id,
        tenantId: request.tenantId,
        emailHash: request.subjectEmailHash,
        participantId: request.subjectId,
        externalId: request.subjectExternalId
    };
}
