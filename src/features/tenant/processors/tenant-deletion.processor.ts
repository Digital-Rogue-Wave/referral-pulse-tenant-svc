import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';

import type { AllConfigType } from '@config/config.type';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TENANT_DELETION_QUEUE, type TenantDeletionJobData, type IJobResult } from '@app/types';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { DateService } from '@common/helper/date.service';
import { BaseWorkerService, BullJobsConnectionFactory } from '@common/bulljobs';

import { TenantService } from '../tenant.service';

@Injectable()
export class TenantDeletionProcessor extends BaseWorkerService<TenantDeletionJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly tenantService: TenantService
    ) {
        super(TENANT_DELETION_QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    protected async processJob(job: Job<TenantDeletionJobData>): Promise<IJobResult> {
        const { tenantId, scheduledAt, reason } = job.data;

        this.logger.log(`Processing tenant deletion job for tenant ${tenantId}`, {
            tenantId,
            scheduledAt,
            reason
        });

        await this.tenantService.executeDeletion(tenantId);
        this.logger.log(`Successfully deleted tenant ${tenantId}`, { tenantId });

        return { success: true };
    }
}
