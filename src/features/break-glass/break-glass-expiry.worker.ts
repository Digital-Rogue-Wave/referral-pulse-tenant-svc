import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { IBaseJobData, IJobResult } from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';

import { BREAK_GLASS_QUEUE, BreakGlassExpiryJob, BreakGlassService } from './break-glass.service';

/** Closes a break-glass window when its hour is up and records the expiry (E1 D17). Worker mode only. */
@Injectable()
export class BreakGlassExpiryWorker extends BaseWorkerService<IBaseJobData & BreakGlassExpiryJob> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly breakGlass: BreakGlassService
    ) {
        super(BREAK_GLASS_QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    protected async processJob(job: Job<IBaseJobData & BreakGlassExpiryJob>): Promise<IJobResult> {
        await this.breakGlass.expire(job.data);
        return { success: true, data: { grantId: job.data.grantId } };
    }
}
