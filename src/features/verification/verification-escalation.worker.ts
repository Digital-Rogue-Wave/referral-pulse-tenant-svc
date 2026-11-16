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

import { CompanyVerificationService, EscalationJob, VERIFICATION_ESCALATION_QUEUE } from './company-verification.service';

/** Sends a company verification still open after seven days to Super Admin review (E1 D15). Worker mode only. */
@Injectable()
export class VerificationEscalationWorker extends BaseWorkerService<IBaseJobData & EscalationJob> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly verifications: CompanyVerificationService
    ) {
        super(VERIFICATION_ESCALATION_QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    protected async processJob(job: Job<IBaseJobData & EscalationJob>): Promise<IJobResult> {
        await this.verifications.escalate(job.data);
        return { success: true, data: { verificationId: job.data.verificationId } };
    }
}
