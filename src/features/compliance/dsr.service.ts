import { HttpStatus, Injectable } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { DSR_FANOUT_JOB, DSR_FANOUT_QUEUE } from '@app/types';
import { BullJobsService } from '@common/bulljobs';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { hashEmail } from '@common/helper/hashing';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import {
    ComplianceEvents,
    CreateDsrDto,
    DsrRequestProps,
    DsrRequestResponse,
    DsrRequestedEvent,
    DsrRequestType,
    DsrStatus,
    dsrDueAt,
    toDsrRequestResponse
} from '@domains/compliance';

/**
 * Data-subject requests — `POST /v1/dsr` and `GET /v1/dsr/{id}` (API Contract §3.15).
 *
 * This service is the single coordinating owner of compliance (Product Spec R-CPL-01), so a request is
 * recorded here, dated here, and — for erasure — fanned out from here. The subject's email never lands
 * in a column: it is hashed on arrival, which is also the form the other six services match on.
 */
@Injectable()
export class DsrService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly bullJobs: BullJobsService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(DsrService.name);
    }

    /**
     * Records a request and starts it. An erasure is queued for fan-out; `access` and `portability`
     * rest at `accepted` — they are recorded, dated and answerable, but no v5 document specifies what
     * the other six services return for them, and inventing six collect contracts would be worse than
     * saying so (NOTE.md §V5.16).
     */
    async create(dto: CreateDsrDto, actorUserId: string): Promise<DsrRequestResponse> {
        const tenantId = this.tenantAware.getRequiredTenantId();
        const isErasure = dto.requestType === DsrRequestType.ERASURE;
        const subject = {
            subjectEmailHash: dto.subjectEmail ? hashEmail(dto.subjectEmail) : null,
            subjectExternalId: dto.subjectExternalId ?? null,
            subjectId: dto.subjectId ?? null
        };

        const created = await this.prisma.$transaction(async (tx) => {
            const row = (await tx.dsrRequest.create({
                data: {
                    tenantId,
                    ...subject,
                    requestType: dto.requestType,
                    status: isErasure ? DsrStatus.PENDING : DsrStatus.ACCEPTED,
                    requestedBy: actorUserId,
                    dueAt: dsrDueAt(new Date())
                }
            })) as DsrRequestProps;
            this.txEventEmitter.emitAfterCommit(
                ComplianceEvents.DSR_REQUESTED,
                new DsrRequestedEvent(row.id, tenantId, { requestType: row.requestType, ...subject, dueAt: row.dueAt }, actorUserId)
            );
            return row;
        });

        if (isErasure) {
            await this.bullJobs.addJob(DSR_FANOUT_QUEUE, DSR_FANOUT_JOB, { tenantId, dsrId: created.id, userId: actorUserId });
        }
        this.logger.log('Data-subject request recorded', { dsrId: created.id, requestType: created.requestType, dueAt: created.dueAt });
        return toDsrRequestResponse({ ...created, receipts: [] });
    }

    /** The subject's proof of what happened: the request, its deadline, and every receipt so far. */
    async findOne(id: string): Promise<DsrRequestResponse> {
        const row = (await this.prisma.dsrRequest.findFirst({
            // `includeSoftDeleted` because `dsr_requests` has no `deletedAt`: a data-subject request is
            // the proof that the request was answered, so it is never soft-deleted. Without this the
            // filter adds `deletedAt: null` and Prisma rejects the query as an unknown argument.
            where: this.tenantAware.withTenantFilter({ id }, { includeSoftDeleted: true }),
            include: { receipts: { orderBy: { serviceName: 'asc' } } }
        })) as DsrRequestProps | null;
        if (!row) {
            throw new BaseException('not_found', `Data-subject request not found: ${id}`, HttpStatus.NOT_FOUND);
        }
        return toDsrRequestResponse(row);
    }
}
