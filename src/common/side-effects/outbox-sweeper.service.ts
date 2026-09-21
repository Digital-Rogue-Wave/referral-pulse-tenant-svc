import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { IBaseJobData, IJobResult, IOutboxJobData, SideEffectType } from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';
import { DatabaseService } from '@app/database/database.service';

const SWEEPER_QUEUE = 'outbox-sweeper';
const SWEEP_JOB = 'sweep-stale-outbox';
const OUTBOX_QUEUE = 'outbox-processor';
/** A pending row older than this lost its enqueue (the enqueue is best-effort after the insert). */
const STALE_PENDING_MS = 60_000;
/** A row stuck in `processing` this long belongs to a worker that died mid-job. */
const STALE_PROCESSING_MS = 5 * 60_000;
const SWEEP_BATCH = 200;

/**
 * The outbox's safety net (DB Model v2 §0.6 — "an acknowledged event is eventually processed").
 * Every minute, re-enqueues rows whose BullMQ job was lost, and releases rows held by a crashed worker.
 * Rows that exhausted their retries stay `failed` for an operator.
 */
@Injectable()
export class OutboxSweeperService extends BaseWorkerService<IBaseJobData> {
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
        super(SWEEPER_QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    override onModuleInit(): void {
        super.onModuleInit();
        if (this.configService.get<boolean>('app.isWorker', { infer: true })) {
            void this.bullJobs.addRepeatingJob(SWEEPER_QUEUE, SWEEP_JOB, { tenantId: 'system' }, { every: 60_000 });
        }
    }

    protected async processJob(): Promise<IJobResult> {
        const now = Date.now();
        const released = await this.prisma.sideEffectOutbox.updateMany({
            where: { status: 'processing', updatedAt: { lt: new Date(now - STALE_PROCESSING_MS) } },
            data: { status: 'pending' }
        });

        const stale = await this.prisma.sideEffectOutbox.findMany({
            where: { status: 'pending', updatedAt: { lt: new Date(now - STALE_PENDING_MS) } },
            orderBy: { createdAt: 'asc' },
            take: SWEEP_BATCH,
            select: {
                id: true,
                tenantId: true,
                effectType: true,
                aggregateType: true,
                aggregateId: true,
                eventType: true,
                maxRetries: true,
                retryCount: true
            }
        });

        for (const row of stale) {
            const jobData: IOutboxJobData = {
                sideEffectId: row.id,
                effectType: row.effectType as SideEffectType,
                aggregateType: row.aggregateType,
                aggregateId: row.aggregateId,
                eventType: row.eventType,
                tenantId: row.tenantId
            };
            await this.bullJobs.addJob(OUTBOX_QUEUE, `process-${row.effectType}`, jobData, {
                jobId: `${row.id}-sweep-${now}`,
                attempts: Math.max(1, row.maxRetries - row.retryCount),
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: 100,
                removeOnFail: 500
            });
        }

        if (released.count > 0 || stale.length > 0) {
            this.logger.warn('Outbox sweep re-enqueued stale side effects', { released: released.count, reEnqueued: stale.length });
        }
        return { success: true, data: { released: released.count, reEnqueued: stale.length } };
    }
}
