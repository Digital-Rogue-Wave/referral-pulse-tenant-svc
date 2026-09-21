import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { IBaseJobData, IJobResult } from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';
import { DatabaseService } from '@app/database/database.service';

const QUEUE = 'idempotency-key-sweeper';

/** Hourly purge of request-idempotency rows past their 24 h window (DB Model v2 §0.7 `idx_idem_expiry`). */
@Injectable()
export class IdempotencyKeySweeperWorker extends BaseWorkerService<IBaseJobData> {
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
            void this.bullJobs.addRepeatingJob(QUEUE, 'purge-expired', { tenantId: 'system' }, { pattern: '15 * * * *' });
        }
    }

    protected async processJob(): Promise<IJobResult> {
        const purged = await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
        return { success: true, data: { purged: purged.count } };
    }
}
