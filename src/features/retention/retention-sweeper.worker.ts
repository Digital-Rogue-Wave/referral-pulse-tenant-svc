import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { IBaseJobData, IJobResult } from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { InvitationStatusEnum } from '@common/enums/invitation.enum';
import { TenantStatus } from '@domains/tenant/tenant.types';

import type { AllConfigType } from '@config/config.type';
import { DatabaseService } from '@app/database/database.service';

const QUEUE = 'retention-sweeper';
const DAY_MS = 86_400_000;

/** API Contract v1.3 §8.3: the audit trail lives for the tenant's lifetime plus 12 months. */
export const AUDIT_AFTER_CLOSE_DAYS = 365;
/** An invitation that can no longer be accepted keeps the invitee's address this long, then is deleted. */
export const INVITATION_AFTER_END_DAYS = 30;
/** Delivered side effects are kept this long for troubleshooting (DB Model v2 §0.6 keeps published events 7 days). */
export const SIDE_EFFECT_AFTER_DONE_DAYS = 7;
/** Applied Stripe events are kept this long to explain billing state, then pruned (Stripe keeps its own 30 days). */
export const STRIPE_EVENT_AFTER_DONE_DAYS = 90;
/** Closed tenants handled per run, so one run stays one bounded delete. */
const CLOSED_TENANT_BATCH = 500;

/**
 * Nightly retention sweep for the data tenant-service holds beyond its useful life (retention defaults,
 * decision X-10). Event data retention (`tenants.retention_months`) is applied by the services that hold
 * event data; tenant-service only stores and publishes the setting.
 */
@Injectable()
export class RetentionSweeperWorker extends BaseWorkerService<IBaseJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly prisma: DatabaseService,
        private readonly bullJobs: BullJobsService
    ) {
        super(QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    override onModuleInit(): void {
        super.onModuleInit();
        if (this.configService.get<boolean>('app.isWorker', { infer: true })) {
            void this.bullJobs.addRepeatingJob(QUEUE, 'sweep', { tenantId: 'system' }, { pattern: '20 4 * * *' });
        }
    }

    protected async processJob(): Promise<IJobResult> {
        const now = Date.now();
        return {
            success: true,
            data: {
                auditRows: await this.purgeAuditOfClosedTenants(new Date(now - AUDIT_AFTER_CLOSE_DAYS * DAY_MS)),
                invitations: await this.purgeEndedInvitations(new Date(now - INVITATION_AFTER_END_DAYS * DAY_MS)),
                sideEffects: await this.purgeDoneSideEffects(new Date(now - SIDE_EFFECT_AFTER_DONE_DAYS * DAY_MS)),
                stripeEvents: await this.purgeDoneStripeEvents(new Date(now - STRIPE_EVENT_AFTER_DONE_DAYS * DAY_MS))
            }
        };
    }

    async purgeAuditOfClosedTenants(closedBefore: Date): Promise<number> {
        const tenants = await this.prisma.tenant.findMany({
            where: { status: TenantStatus.CLOSED, deletedAt: { lt: closedBefore } },
            select: { id: true },
            take: CLOSED_TENANT_BATCH
        });
        if (tenants.length === 0) {
            return 0;
        }
        const purged = await this.prisma.auditLog.deleteMany({ where: { tenantId: { in: tenants.map((tenant) => tenant.id) } } });
        return purged.count;
    }

    async purgeEndedInvitations(endedBefore: Date): Promise<number> {
        const purged = await this.prisma.invitation.deleteMany({
            where: {
                OR: [
                    { status: InvitationStatusEnum.PENDING, expiresAt: { lt: endedBefore } },
                    { status: { not: InvitationStatusEnum.PENDING }, updatedAt: { lt: endedBefore } }
                ]
            }
        });
        return purged.count;
    }

    async purgeDoneSideEffects(doneBefore: Date): Promise<number> {
        const purged = await this.prisma.sideEffectOutbox.deleteMany({ where: { status: 'completed', updatedAt: { lt: doneBefore } } });
        return purged.count;
    }

    /** Failed events are kept until an operator has looked at them. */
    async purgeDoneStripeEvents(doneBefore: Date): Promise<number> {
        const purged = await this.prisma.stripeEvent.deleteMany({
            where: { status: { in: ['processed', 'ignored'] }, receivedAt: { lt: doneBefore } }
        });
        return purged.count;
    }
}
