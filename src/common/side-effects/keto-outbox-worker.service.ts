import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { IWorkerConfig } from '@app/types';

import { KetoProvisioningService } from '@common/auth/authz/keto-provisioning.service';
import { BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { SnsPublisherService } from '@common/messaging/sns-publisher.service';
import { SqsProducerService } from '@common/messaging/sqs-producer.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';
import { DatabaseService } from '@app/database/database.service';

import { OutboxWorkerService } from './outbox-worker.service';
import { KETO_OUTBOX_QUEUE } from './side-effect-outbox.type';

/**
 * Runs Keto membership effects strictly one at a time, in order, across every worker pod (E1 decision D7,
 * US1.3.1 F2). Same processing as the outbox worker; only the queue and the concurrency differ.
 */
@Injectable()
export class KetoOutboxWorkerService extends OutboxWorkerService {
    static override readonly QUEUE_NAME = KETO_OUTBOX_QUEUE;

    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        prisma: DatabaseService,
        sqsProducer: SqsProducerService,
        snsPublisher: SnsPublisherService,
        ketoProvisioning: KetoProvisioningService,
        private readonly bullJobs: BullJobsService
    ) {
        super(
            connectionFactory,
            configService,
            logger,
            metricsService,
            tracingService,
            tenantContext,
            dateService,
            prisma,
            sqsProducer,
            snsPublisher,
            ketoProvisioning
        );
    }

    override onModuleInit(): void {
        super.onModuleInit();
        if (this.configService.get<boolean>('app.isWorker', { infer: true })) {
            void this.bullJobs.setGlobalConcurrency(KETO_OUTBOX_QUEUE, 1);
        }
    }

    protected override getWorkerConfig(): IWorkerConfig {
        return { concurrency: 1 };
    }
}
