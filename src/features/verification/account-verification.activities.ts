import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import { PrivilegedDatabaseService } from '@app/database/privileged-database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { VerificationRecordStatus } from '@domains/tenant/tenant.types';

import type { AccountVerificationActivities as Activities, AccountVerificationInput } from './workflows';

const SLA_BREACHED = 'tenant_verification.sla_breached';

/** The `account_verification` workflow's one activity (US1.6.1 AC3). */
@Injectable()
export class AccountVerificationActivities implements Activities {
    constructor(
        private readonly prisma: PrivilegedDatabaseService,
        private readonly metrics: MetricsService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(AccountVerificationActivities.name);
    }

    /**
     * The internal alert for a review open past seven days: an error log and `kyb_review_sla_breached_total` (what the
     * alert policy watches), plus one audit row. A case decided in the meantime raises nothing; a retried attempt
     * finds its audit row and writes no second one.
     */
    async reportSlaBreach({ tenantId, verificationId }: AccountVerificationInput): Promise<void> {
        const record = await this.prisma.tenantVerification.findFirst({ where: { id: verificationId, tenantId }, select: { status: true } });
        if (record?.status !== VerificationRecordStatus.PENDING_REVIEW) {
            return;
        }
        if (await this.prisma.auditLog.findFirst({ where: { tenantId, action: SLA_BREACHED, targetId: verificationId }, select: { id: true } })) {
            return;
        }
        this.metrics.createCounter('kyb_review_sla_breached_total').add(1);
        this.logger.error('Company verification review breached its 7-day SLA', undefined, { tenantId, verificationId });
        await this.prisma.auditLog.create({
            data: {
                id: ulid(),
                tenantId,
                actorUserId: 'system',
                action: SLA_BREACHED,
                targetType: 'tenant_verification',
                targetId: verificationId,
                reason: 'In pending_review for 7 days without a Super Admin decision',
                occurredAt: new Date()
            }
        });
    }
}
