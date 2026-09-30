import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TENANT_UNLOCK_QUEUE, type IBaseJobData, type IJobResult } from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

import type { AllConfigType } from '@config/config.type';

import { TenantService } from '../tenant.service';

/**
 * Every 5 minutes, unlocks the tenants whose `lock_until` has passed. Driven by the database, so a timed
 * lock expires even though nothing queued a job for it (nothing ever did: timed locks never expired).
 */
@Injectable()
export class TenantUnlockProcessor extends BaseWorkerService<IBaseJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly tenantService: TenantService,
        private readonly bullJobs: BullJobsService
    ) {
        super(TENANT_UNLOCK_QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    override onModuleInit(): void {
        super.onModuleInit();
        if (this.configService.get<boolean>('app.isWorker', { infer: true })) {
            void this.bullJobs.addRepeatingJob(TENANT_UNLOCK_QUEUE, 'unlock-expired', { tenantId: 'system' }, { pattern: '*/5 * * * *' });
        }
    }

    protected async processJob(): Promise<IJobResult> {
        return { success: true, data: { unlocked: await this.tenantService.unlockExpired() } };
    }
}
