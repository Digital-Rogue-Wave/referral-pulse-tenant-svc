import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import type { Prisma } from '@prisma-gen/generated/client';

import { BullJobsService } from '@common/bulljobs';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DatabaseService } from '@app/database/database.service';
import { TenantService } from '@app/features/tenant/tenant.service';
import { TenantEvents, TenantVerificationRequestedEvent, TenantVerificationStatusChangedEvent } from '@domains/tenant/events/tenant.events';
import { VerificationRecordStatus, VerificationStatus, VerificationType } from '@domains/tenant/tenant.types';
import { CompanyVerificationResponse, VerificationSessionResponse } from '@domains/verification';

import { KYB_PROVIDER, KybProvider } from './kyb-provider';

/** E1 D15: a company verification still open after seven days goes to a Super Admin. */
export const VERIFICATION_ESCALATION_DAYS = 7;
export const VERIFICATION_ESCALATION_QUEUE = 'verification-escalation';

const OPEN = [VerificationRecordStatus.PENDING, VerificationRecordStatus.IN_REVIEW];

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

export interface EscalationJob {
    tenantId: string;
    verificationId: string;
}

/**
 * Company verification through a KYB provider (Product Spec R-INT-02, E1 D15). The Owner opens a session (the tenant
 * moves `unverified | rejected → pending`); the provider's result arrives through Event Ingestion and is applied with
 * `TenantService.applyVerificationReport()`; a result the provider cannot settle, or a case still open after seven days,
 * goes to `in_review` for a Super Admin.
 */
@Injectable()
export class CompanyVerificationService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenants: TenantService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly bullJobs: BullJobsService,
        @Inject(KYB_PROVIDER) private readonly provider: KybProvider,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(CompanyVerificationService.name);
    }

    /** The tenant's verification state and its latest company verification, for the Owner's dashboard. */
    async status(tenantId: string): Promise<CompanyVerificationResponse> {
        const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { verificationStatus: true } });
        const latest = await this.latest(tenantId);
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
     * Opens (or reopens) the KYB session. With a verification already open, the Owner gets a fresh link to the same case;
     * otherwise — never verified, or rejected (resubmission) — a new verification starts and the tenant becomes `pending`.
     * A verified tenant has nothing to submit.
     */
    async open(tenantId: string, actingUserId: string): Promise<VerificationSessionResponse> {
        const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, verificationStatus: true } });
        if (tenant.verificationStatus === VerificationStatus.VERIFIED) {
            throw new BaseException('state_conflict', 'This company is already verified', HttpStatus.CONFLICT);
        }
        const open = await this.prisma.tenantVerification.findFirst({
            where: { tenantId, verificationType: VerificationType.COMPANY, status: { in: OPEN } },
            orderBy: { createdAt: 'desc' }
        });
        const verificationId = open?.id ?? ulid();
        const session = await this.provider.openSession(tenantId, verificationId);
        if (!open) {
            await this.start(tenantId, verificationId, tenant, actingUserId, {
                provider: session.provider,
                external_user_id: session.externalUserId
            });
        }
        return { status: VerificationStatus.PENDING, verificationId, provider: session.provider, providerUrl: session.url };
    }

    /** The provider's result (through Event Ingestion), applied to the exact verification it names. */
    async applyProviderResult(result: ProviderVerificationResult): Promise<void> {
        const record = await this.prisma.tenantVerification.findFirst({ where: { id: result.verificationId, tenantId: result.tenantId } });
        if (!record) {
            this.logger.warn('KYB result for an unknown verification; ignored', { tenantId: result.tenantId, verificationId: result.verificationId });
            return;
        }
        if (!OPEN.includes(record.status as VerificationRecordStatus)) {
            // A provider re-delivery or a late result after a Super Admin decided: the decision stands.
            this.logger.log('KYB result for a verification already decided; ignored', { verificationId: record.id, status: record.status });
            return;
        }
        await this.tenants.applyVerificationReport(result.tenantId, {
            verificationId: record.id,
            verificationType: VerificationType.COMPANY,
            status: result.outcome as VerificationRecordStatus,
            reason: result.reason ?? undefined,
            reviewedBy: `provider:${result.provider}`,
            evidence: {
                ...(record.evidence as Record<string, unknown> | null),
                result: { outcome: result.outcome, reference: result.providerReference, labels: result.labels, retry_allowed: result.retryAllowed }
            }
        });
    }

    /** The seven-day job: still pending → in review for a Super Admin; either way the escalation is on the trail. */
    async escalate(job: EscalationJob): Promise<void> {
        const record = await this.prisma.tenantVerification.findFirst({ where: { id: job.verificationId, tenantId: job.tenantId } });
        if (!record || !OPEN.includes(record.status as VerificationRecordStatus)) {
            return;
        }
        if (record.status === VerificationRecordStatus.PENDING) {
            await this.tenants.applyVerificationReport(job.tenantId, {
                verificationId: record.id,
                verificationType: VerificationType.COMPANY,
                status: VerificationRecordStatus.IN_REVIEW,
                reviewedBy: 'system'
            });
        }
        await this.prisma.auditLog.create({
            data: {
                id: ulid(),
                tenantId: job.tenantId,
                actorUserId: 'system',
                action: 'tenant_verification.escalated',
                targetType: 'tenant_verification',
                targetId: record.id,
                reason: `Open for ${VERIFICATION_ESCALATION_DAYS} days: sent to Super Admin review`,
                occurredAt: new Date()
            }
        });
        this.logger.warn('Company verification escalated to Super Admin review', { tenantId: job.tenantId, verificationId: record.id });
    }

    private async start(
        tenantId: string,
        verificationId: string,
        tenant: { name: string; verificationStatus: string },
        actingUserId: string,
        evidence: Record<string, unknown>
    ): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.tenantVerification.create({
                data: { id: verificationId, tenantId, verificationType: VerificationType.COMPANY, evidence: evidence as Prisma.InputJsonValue }
            });
            await tx.tenant.update({ where: { id: tenantId }, data: { verificationStatus: VerificationStatus.PENDING } });
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.VERIFICATION_REQUESTED,
                new TenantVerificationRequestedEvent(tenantId, tenantId, tenant.name, actingUserId, verificationId)
            );
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.VERIFICATION_STATUS_CHANGED,
                new TenantVerificationStatusChangedEvent(
                    tenantId,
                    tenantId,
                    tenant.verificationStatus,
                    VerificationStatus.PENDING,
                    undefined,
                    actingUserId
                )
            );
        });
        await this.bullJobs.addDelayedJob<EscalationJob & { tenantId: string }>(
            VERIFICATION_ESCALATION_QUEUE,
            'escalate',
            { tenantId, verificationId },
            VERIFICATION_ESCALATION_DAYS * 86_400_000,
            { jobId: `verification-escalation-${verificationId}` }
        );
        this.logger.log('Company verification started', { tenantId, verificationId, provider: this.provider.name });
    }

    private latest(tenantId: string) {
        return this.prisma.tenantVerification.findFirst({
            where: { tenantId, verificationType: VerificationType.COMPANY },
            orderBy: { createdAt: 'desc' }
        });
    }
}

function providerOf(evidence: unknown): string | null {
    const value = (evidence as { provider?: unknown } | null)?.provider;
    return typeof value === 'string' ? value : null;
}
