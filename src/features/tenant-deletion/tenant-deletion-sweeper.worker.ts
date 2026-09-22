import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import { TENANT_DELETION_QUEUE, type IBaseJobData, type IJobResult } from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';

import { TenantDeletionService } from './tenant-deletion.service';

/**
 * Hourly sweep that runs the deletion saga for every tenant past its `deletion_due_at`. Driven by the
 * database, so a scheduled deletion survives Redis loss and a failed run is simply retried next hour.
 */
@Injectable()
export class TenantDeletionSweeperWorker extends BaseWorkerService<IBaseJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly deletions: TenantDeletionService,
        private readonly bullJobs: BullJobsService
    ) {
        super(TENANT_DELETION_QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    override onModuleInit(): void {
        super.onModuleInit();
        if (this.configService.get<boolean>('app.isWorker', { infer: true })) {
            void this.bullJobs.addRepeatingJob(TENANT_DELETION_QUEUE, 'sweep-due-deletions', { tenantId: 'system' }, { pattern: '5 * * * *' });
        }
    }

    protected async processJob(): Promise<IJobResult> {
        let deleted = 0;
        const failed: string[] = [];
        for (const tenantId of await this.deletions.findDue()) {
            try {
                deleted += (await this.deletions.execute(tenantId)) ? 1 : 0;
            } catch (error) {
                failed.push(tenantId);
                this.logger.error('Tenant deletion failed; it is retried on the next sweep', error instanceof Error ? error.stack : undefined, {
                    tenantId
                });
            }
        }
        return { success: failed.length === 0, data: { deleted, failed } };
    }
}
