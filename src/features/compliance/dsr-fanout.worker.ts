import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Job } from 'bullmq';

import { DSR_FANOUT_JOB, DSR_FANOUT_QUEUE, DSR_SWEEP_JOB, type IBaseJobData, type IJobResult, type IWorkerConfig } from '@app/types';
import { BaseWorkerService, BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

import type { AllConfigType } from '@config/config.type';

import { DsrFanOutService } from './dsr-fanout.service';

/** Unfinished erasures re-asked per sweep, so one run stays one bounded set of calls. */
const SWEEP_BATCH = 50;

export interface DsrFanOutJobData extends IBaseJobData {
    dsrId?: string;
}

/**
 * Runs the erasure fan-out, and sweeps the ones still waiting.
 *
 * Two jobs on one queue. `dsr-fan-out` is enqueued when an erasure is submitted; `dsr-sweep` re-asks
 * every target that has not answered, hourly. The sweep is what makes R-CPL-02's one-month deadline
 * reachable while five of the six erasure handlers do not exist yet: a target that is missing or down
 * leaves a `pending` receipt, and the next sweep asks it again rather than the request sitting
 * half-done until someone notices.
 *
 * Erasure runs at concurrency 1: the fan-out is six sequential calls per request, and a subject being
 * erased from six services is not work worth racing.
 */
@Injectable()
export class DsrFanOutWorker extends BaseWorkerService<DsrFanOutJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly fanOut: DsrFanOutService,
        private readonly bullJobs: BullJobsService
    ) {
        super(DSR_FANOUT_QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    override onModuleInit(): void {
        super.onModuleInit();
        if (this.configService.get<boolean>('app.isWorker', { infer: true })) {
            void this.bullJobs.addRepeatingJob(DSR_FANOUT_QUEUE, DSR_SWEEP_JOB, { tenantId: 'system' }, { pattern: '35 * * * *' });
        }
    }

    protected override getWorkerConfig(): IWorkerConfig {
        return { concurrency: 1 };
    }

    protected async processJob(job: Job<DsrFanOutJobData>): Promise<IJobResult> {
        if (job.name === DSR_SWEEP_JOB) {
            return this.sweep();
        }
        const { dsrId, tenantId } = job.data;
        if (!dsrId) {
            // Unrecoverable by BaseWorkerService's own rule — a job with no subject cannot be retried
            // into one.
            throw new Error(`invalid data: ${DSR_FANOUT_JOB} needs a dsrId`);
        }
        const outcome = await this.fanOut.run(dsrId, tenantId);
        return { success: outcome.outstanding.length === 0, data: outcome };
    }

    /** Re-asks the targets that still owe an answer, and keeps going past one that fails. */
    private async sweep(): Promise<IJobResult> {
        const unfinished = await this.fanOut.findUnfinished(SWEEP_BATCH);
        const stillWaiting: string[] = [];
        const failed: string[] = [];

        for (const request of unfinished) {
            try {
                const outcome = await this.fanOut.run(request.id, request.tenantId);
                if (outcome.outstanding.length > 0) {
                    stillWaiting.push(request.id);
                }
            } catch (error) {
                failed.push(request.id);
                this.logger.error('An erasure fan-out could not be resumed', error instanceof Error ? error.stack : undefined, {
                    dsrId: request.id
                });
            }
        }
        return { success: failed.length === 0, data: { swept: unfinished.length, stillWaiting, failed } };
    }
}
