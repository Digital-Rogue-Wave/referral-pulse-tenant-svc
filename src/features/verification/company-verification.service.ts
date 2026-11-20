import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';

import type { Prisma } from '@prisma-gen/generated/client';

import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { RedisService } from '@common/redis/redis.service';
import { DatabaseService } from '@app/database/database.service';
import type { AllConfigType } from '@config/config.type';
import { TenantEvents, TenantVerificationRequestedEvent } from '@domains/tenant/events/tenant.events';
import { VerificationRecordStatus, VerificationStatus, VerificationType } from '@domains/tenant/tenant.types';
import { CompanyVerificationResponse, VerificationSessionResponse } from '@domains/verification';

import { AccountVerificationGateway } from './account-verification.gateway';
import { KYB_PROVIDER, KybProvider } from './kyb-provider';
import { TenantVerificationStatus } from './tenant-verification-status';

/** The provider's result, as Event Ingestion normalises it (`provider.verification_reviewed`). */
export interface ProviderVerificationResult {
    tenantId: string;
    verificationId: string;
    provider: string;
    outcome: 'verified' | 'rejected' | 'in_review';
    reason: string | null;
    retryAllowed: boolean;
    providerReference: string | null;
    labels: string[];
}

/** The verification id of a session opened but not yet called back, so a second click reuses the same applicant. */
const sessionKey = (tenantId: string): string => `tenant:kyb-session:${tenantId}`;

/**
 * Company verification (v5.2 API §3.17, US1.6.4, US1.6.1). The Owner opens a KYB session; nothing changes until the
 * provider calls back through Event Ingestion. That callback opens the case in `pending_review` with the provider's
 * result as evidence (references only) and starts the `account_verification` workflow; a Super Admin then decides.
 */
@Injectable()
export class CompanyVerificationService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly verificationStatus: TenantVerificationStatus,
        private readonly workflows: AccountVerificationGateway,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly redis: RedisService,
        private readonly metrics: MetricsService,
        private readonly configService: ConfigService<AllConfigType>,
        @Inject(KYB_PROVIDER) private readonly provider: KybProvider,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(CompanyVerificationService.name);
    }

    /** The tenant's verification state and its latest company verification, for the Owner's dashboard. */
    async status(tenantId: string): Promise<CompanyVerificationResponse> {
        const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { verificationStatus: true } });
        const latest = await this.prisma.tenantVerification.findFirst({
            where: { tenantId, verificationType: VerificationType.COMPANY },
            orderBy: { createdAt: 'desc' }
        });
        return {
            status: tenant.verificationStatus,
            verification: latest
                ? {
                      id: latest.id,
                      status: latest.status,
                      reason: latest.reason,
                      provider: providerOf(latest.evidence),
                      submittedAt: latest.createdAt.toISOString(),
                      reviewedAt: latest.reviewedAt?.toISOString() ?? null
                  }
                : null
        };
    }

    /**
     * Opens the provider's hosted session (US1.6.4 AC1). The status does not move: `pending_review` begins with the
     * provider's callback. A verified company, or one already under review, has nothing to submit; a rejected one may
     * resubmit.
     */
    async open(tenantId: string, actingUserId: string): Promise<VerificationSessionResponse> {
        const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, verificationStatus: true } });
        if (tenant.verificationStatus === VerificationStatus.VERIFIED || tenant.verificationStatus === VerificationStatus.PENDING_REVIEW) {
            throw new BaseException('state_conflict', `This company's verification is ${tenant.verificationStatus}`, HttpStatus.CONFLICT);
        }
        const verificationId = await this.sessionVerificationId(tenantId);
        const session = await this.provider.openSession(tenantId, verificationId);
        this.txEventEmitter.emitAfterCommit(
            TenantEvents.VERIFICATION_REQUESTED,
            new TenantVerificationRequestedEvent(tenantId, tenantId, tenant.name, actingUserId, verificationId)
        );
        this.logger.log('KYB session opened', { tenantId, verificationId, provider: session.provider });
        return { status: tenant.verificationStatus, verificationId, provider: session.provider, providerUrl: session.url };
    }

    /**
     * The provider's callback (US1.6.4 AC2): the first one opens the case in `pending_review`; a later one, while the
     * case is still under review, refreshes the evidence. A case a Super Admin already decided is final.
     */
    async applyProviderResult(result: ProviderVerificationResult): Promise<void> {
        const opened = await this.prisma.$transaction(async (tx) => {
            const record = await tx.tenantVerification.findFirst({ where: { id: result.verificationId, tenantId: result.tenantId } });
            if (record && record.status !== VerificationRecordStatus.PENDING_REVIEW) {
                this.logger.log('KYB result for a verification already decided; ignored', { verificationId: record.id, status: record.status });
                return null;
            }
            const evidence = { ...((record?.evidence as Record<string, unknown> | null) ?? {}), ...evidenceOf(result) } as Prisma.InputJsonValue;
            if (record) {
                await tx.tenantVerification.update({ where: { id: record.id }, data: { evidence } });
                return record.temporalWorkflowId ? null : record.id;
            }
            if (!(await tx.tenant.findUnique({ where: { id: result.tenantId }, select: { id: true } }))) {
                this.logger.warn('KYB result for an unknown tenant; ignored', { tenantId: result.tenantId });
                return null;
            }
            await tx.tenantVerification.create({
                data: {
                    id: result.verificationId,
                    tenantId: result.tenantId,
                    verificationType: VerificationType.COMPANY,
                    status: VerificationRecordStatus.PENDING_REVIEW,
                    evidence
                }
            });
            await this.verificationStatus.change(tx, result.tenantId, VerificationStatus.PENDING_REVIEW, `provider:${result.provider}`, null);
            return result.verificationId;
        });
        if (opened) {
            await this.redis.getClient().del(sessionKey(result.tenantId));
            await this.startWorkflow(result.tenantId, opened);
        }
    }

    /**
     * Starts `account_verification` and stores its ids (US1.6.1 AC2). Temporal being down must not lose the case: the
     * case is already in `pending_review`, the failure is counted, and the provider's next re-delivery retries the start.
     */
    private async startWorkflow(tenantId: string, verificationId: string): Promise<void> {
        try {
            const { workflowId, runId } = await this.workflows.start({ tenantId, verificationId });
            await this.prisma.tenantVerification.update({
                where: { id: verificationId },
                data: { temporalWorkflowId: workflowId, temporalRunId: runId }
            });
            this.logger.log('account_verification started', { tenantId, verificationId, workflowId });
        } catch (error) {
            this.metrics.createCounter('kyb_workflow_start_failures_total').add(1);
            this.logger.error('Could not start account_verification', error instanceof Error ? error.stack : undefined, { tenantId, verificationId });
        }
    }

    private async sessionVerificationId(tenantId: string): Promise<string> {
        const client = this.redis.getClient();
        const existing = await client.get(sessionKey(tenantId));
        if (existing) {
            return existing;
        }
        const verificationId = ulid();
        await client.set(sessionKey(tenantId), verificationId, 'EX', this.configService.getOrThrow('kyb', { infer: true }).linkTtlSeconds);
        return verificationId;
    }
}

function evidenceOf(result: ProviderVerificationResult): Record<string, unknown> {
    return {
        provider: result.provider,
        result: {
            outcome: result.outcome,
            reason: result.reason,
            reference: result.providerReference,
            labels: result.labels,
            retry_allowed: result.retryAllowed
        }
    };
}

function providerOf(evidence: unknown): string | null {
    const value = (evidence as { provider?: unknown } | null)?.provider;
    return typeof value === 'string' ? value : null;
}
