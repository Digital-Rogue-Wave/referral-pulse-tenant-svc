import { HttpStatus, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { PrivilegedDatabaseService } from '@app/database/privileged-database.service';
import { VerificationRecordStatus, VerificationStatus, VerificationType } from '@domains/tenant/tenant.types';
import { AdminVerificationDetailResponse, AdminVerificationResponse } from '@domains/verification';

import { AccountVerificationGateway } from './account-verification.gateway';
import { TenantVerificationStatus } from './tenant-verification-status';

const REVIEW_LIST_LIMIT = 100;

type VerificationRow = {
    id: string;
    tenantId: string;
    status: string;
    reason: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    evidence: unknown;
    temporalWorkflowId: string | null;
    tenant: { name: string };
};

type Decision = VerificationRecordStatus.VERIFIED | VerificationRecordStatus.REJECTED;

/**
 * The Super Admin's review (US1.6.2): every company verification is decided by a person on the platform console, with a
 * reason. The decision is written first — the case, the tenant's status and `tenant.verified`, whose audit row names the
 * staff member and the reason — then the `account_verification` workflow is signalled. Reading a verification's evidence
 * is tenant-data access by staff, so each read goes to that tenant's audit log (Product Spec R-ACT-02).
 */
@Injectable()
export class AdminVerificationService {
    constructor(
        private readonly prisma: PrivilegedDatabaseService,
        private readonly verificationStatus: TenantVerificationStatus,
        private readonly workflows: AccountVerificationGateway,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(AdminVerificationService.name);
    }

    async list(status: VerificationRecordStatus = VerificationRecordStatus.PENDING_REVIEW): Promise<AdminVerificationResponse[]> {
        const rows = await this.prisma.tenantVerification.findMany({
            where: { verificationType: VerificationType.COMPANY, status },
            orderBy: { createdAt: 'asc' },
            take: REVIEW_LIST_LIMIT,
            include: { tenant: { select: { name: true } } }
        });
        return rows.map((row) => toResponse(row));
    }

    async detail(id: string, staffActor: string): Promise<AdminVerificationDetailResponse> {
        const row = await this.find(id);
        await this.prisma.auditLog.create({
            data: {
                id: ulid(),
                tenantId: row.tenantId,
                actorUserId: staffActor,
                action: 'tenant_verification.evidence_read',
                targetType: 'tenant_verification',
                targetId: row.id,
                occurredAt: new Date()
            }
        });
        return { ...toResponse(row), evidence: (row.evidence as Record<string, unknown> | null) ?? null };
    }

    async approve(id: string, staffActor: string, reason: string): Promise<AdminVerificationResponse> {
        return this.decide(id, staffActor, VerificationRecordStatus.VERIFIED, reason);
    }

    async reject(id: string, staffActor: string, reason: string): Promise<AdminVerificationResponse> {
        return this.decide(id, staffActor, VerificationRecordStatus.REJECTED, reason);
    }

    private async decide(id: string, staffActor: string, status: Decision, reason: string): Promise<AdminVerificationResponse> {
        const row = await this.find(id);
        if (row.status !== VerificationRecordStatus.PENDING_REVIEW) {
            throw new BaseException('state_conflict', `This verification is already ${row.status}`, HttpStatus.CONFLICT);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.tenantVerification.update({ where: { id }, data: { status, reason, reviewedBy: staffActor, reviewedAt: new Date() } });
            await this.verificationStatus.change(tx, row.tenantId, status as string as VerificationStatus, staffActor, reason);
        });
        await this.signal(row, status);
        return toResponse(await this.find(id));
    }

    /** Best effort: the decision stands without it, and the workflow's SLA activity checks the case before alerting. */
    private async signal(row: VerificationRow, status: Decision): Promise<void> {
        if (!row.temporalWorkflowId) {
            return;
        }
        try {
            await this.workflows.signalDecided(row.temporalWorkflowId, status);
        } catch (error) {
            this.logger.warn('Could not signal account_verification; the decision stands', {
                verificationId: row.id,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async find(id: string): Promise<VerificationRow> {
        const row = await this.prisma.tenantVerification.findFirst({
            where: { id, verificationType: VerificationType.COMPANY },
            include: { tenant: { select: { name: true } } }
        });
        if (!row) {
            throw new BaseException('resource_not_found', 'Verification not found', HttpStatus.NOT_FOUND);
        }
        return row;
    }
}

function toResponse(row: VerificationRow): AdminVerificationResponse {
    return {
        id: row.id,
        tenantId: row.tenantId,
        tenantName: row.tenant.name,
        status: row.status,
        reason: row.reason,
        submittedAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        reviewedBy: row.reviewedBy
    };
}
