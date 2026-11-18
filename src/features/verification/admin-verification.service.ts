import { HttpStatus, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import { BaseException } from '@common/exceptions/base.exceptions';
import { DatabaseService } from '@app/database/database.service';
import { TenantService } from '@app/features/tenant/tenant.service';
import { VerificationRecordStatus, VerificationType } from '@domains/tenant/tenant.types';
import { AdminVerificationDetailResponse, AdminVerificationResponse } from '@domains/verification';

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
    tenant: { name: string };
};

/**
 * Super Admin review of company verifications the provider could not settle (US1.6.2, E1 D15). Decisions go through
 * `TenantService.applyVerificationReport()` — one path writes the row, the tenant's status and the event, and the event
 * puts the decision on the audit trail. Reading a verification's evidence is tenant-data access by staff, so each read
 * is written to that tenant's audit log (Product Spec R-ACT-02).
 */
@Injectable()
export class AdminVerificationService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenants: TenantService
    ) {}

    async list(status: VerificationRecordStatus = VerificationRecordStatus.IN_REVIEW): Promise<AdminVerificationResponse[]> {
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

    async approve(id: string, staffActor: string): Promise<AdminVerificationResponse> {
        return this.decide(id, staffActor, VerificationRecordStatus.VERIFIED);
    }

    async reject(id: string, staffActor: string, reason: string): Promise<AdminVerificationResponse> {
        return this.decide(id, staffActor, VerificationRecordStatus.REJECTED, reason);
    }

    private async decide(id: string, staffActor: string, status: VerificationRecordStatus, reason?: string): Promise<AdminVerificationResponse> {
        const row = await this.find(id);
        await this.tenants.applyVerificationReport(row.tenantId, {
            verificationId: row.id,
            verificationType: VerificationType.COMPANY,
            status,
            reason,
            reviewedBy: staffActor
        });
        return toResponse(await this.find(id));
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
