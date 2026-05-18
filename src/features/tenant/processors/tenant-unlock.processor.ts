import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';

import { TENANT_UNLOCK_QUEUE, TenantUnlockJobData } from '@app/types';
import type { IJobResult } from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

import type { AllConfigType } from '@config/config.type';

import { TenantService } from '../tenant.service';

@Injectable()
export class TenantUnlockProcessor extends BaseWorkerService<TenantUnlockJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly tenantService: TenantService,
    ) {
        super(
            TENANT_UNLOCK_QUEUE,
            connectionFactory,
            configService,
            logger,
            metricsService,
            tracingService,
            tenantContext,
            dateService,
        );
    }

    protected async processJob(job: Job<TenantUnlockJobData>): Promise<IJobResult> {
        const { tenantId, unlockAt } = job.data;

        this.logger.log(`Processing auto-unlock job for tenant ${tenantId}`, {
            tenantId,
            unlockAt,
        });

        try {
            await this.tenantService.autoUnlock(tenantId);
            this.logger.log(`Successfully unlocked tenant ${tenantId}`, { tenantId });
            return { success: true };
        } catch (error) {
            this.logger.error(
                `Failed to auto-unlock tenant ${tenantId}`,
                error instanceof Error ? error.stack : undefined,
                {
                    tenantId,
                    error: error instanceof Error ? error.message : String(error),
                },
            );
            throw error;
        }
    }
}
