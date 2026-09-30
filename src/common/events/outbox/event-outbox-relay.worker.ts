import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EventOutbox } from '@prisma-gen/generated/client';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { IBaseJobData, IJobResult, IWorkerConfig } from '@app/types';
import { TENANT_EVENTS_TOPIC } from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { SnsPublisherService } from '@common/messaging/sns-publisher.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { DomainMetrics } from '@common/monitoring/domain-metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';
import { DatabaseService } from '@app/database/database.service';

const QUEUE = 'event-outbox-relay';
const RELAY_EVERY_MS = 2_000;
const BATCH_SIZE = 100;
/** After this many failed publishes a row is parked as `failed` for an operator (and alerts). */
const MAX_ATTEMPTS = 10;
/** Published rows are kept this long for replay and audit, then pruned (DB Model v2 §0.6). */
const RETENTION_DAYS = 7;

type Envelope = { actor?: { actor_id?: string }; metadata?: { correlation_id?: string | null } };

/**
 * Publishes `event_outbox` rows to SNS `tenant-events` (Architecture v1.3 §3.2), oldest first,
 * at least once. The transport wrapper keeps the platform's message envelope (consumers built on the
 * shared template read it); its `payload` is the canonical Event Model v3 envelope, its deduplication id
 * is `event_id` and its idempotency key is the event's `external_id` (already namespaced by event type).
 *
 * One relay job runs at a time (concurrency 1), so rows are never published concurrently, and a tenant's
 * events leave in order. A crash between publish and mark only re-publishes, which consumers absorb.
 */
@Injectable()
export class EventOutboxRelayWorker extends BaseWorkerService<IBaseJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly prisma: DatabaseService,
        private readonly bullJobs: BullJobsService,
        private readonly sns: SnsPublisherService,
        private readonly domainMetrics: DomainMetrics
    ) {
        super(QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    override onModuleInit(): void {
        super.onModuleInit();
        if (this.configService.get<boolean>('app.isWorker', { infer: true })) {
            void this.bullJobs.addRepeatingJob(QUEUE, 'relay', { tenantId: 'system' }, { every: RELAY_EVERY_MS });
            void this.bullJobs.addRepeatingJob(QUEUE, 'prune', { tenantId: 'system' }, { pattern: '40 4 * * *' });
        }
    }

    protected override getWorkerConfig(): IWorkerConfig {
        return { concurrency: 1 };
    }

    protected async processJob(job: { name: string }): Promise<IJobResult> {
        if (job.name === 'prune') {
            const pruned = await this.prisma.eventOutbox.deleteMany({
                where: { status: 'published', publishedAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } }
            });
            return { success: true, data: { pruned: pruned.count } };
        }

        const pending = await this.prisma.eventOutbox.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: BATCH_SIZE });
        let published = 0;
        let failed = 0;
        // A tenant's events stay in order: after a failure, its later rows wait for the next run.
        const blocked = new Set<string>();
        for (const row of pending) {
            if (blocked.has(row.tenantId)) {
                continue;
            }
            const outcome = await this.publish(row);
            if (outcome === 'published') {
                published += 1;
            } else {
                blocked.add(row.tenantId);
                failed += outcome === 'failed' ? 1 : 0;
            }
        }
        await this.recordBacklog(published, failed);
        return { success: true, data: { published, attempted: pending.length } };
    }

    private async recordBacklog(published: number, failed: number): Promise<void> {
        const [pending, oldest] = await Promise.all([
            this.prisma.eventOutbox.count({ where: { status: 'pending' } }),
            this.prisma.eventOutbox.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
        ]);
        this.domainMetrics.outboxRun(published, failed, { pending, oldestCreatedAt: oldest?.createdAt ?? null });
    }

    /** `pending`: will be retried next run; `failed`: out of attempts, needs an operator. */
    private async publish(row: EventOutbox): Promise<'published' | 'pending' | 'failed'> {
        const envelope = row.payload as Envelope;
        try {
            await this.tenantContext.runWithContext(
                { tenantId: row.tenantId, userId: envelope.actor?.actor_id ?? 'system', correlationId: envelope.metadata?.correlation_id ?? row.id },
                () =>
                    this.sns.publish(TENANT_EVENTS_TOPIC, row.eventType, row.payload, {
                        idempotencyKey: row.externalId,
                        messageGroupId: row.tenantId,
                        messageDeduplicationId: row.id
                    })
            );
            await this.prisma.eventOutbox.update({ where: { id: row.id }, data: { status: 'published', publishedAt: new Date(), lastError: null } });
            return 'published';
        } catch (error) {
            const attemptCount = row.attemptCount + 1;
            const status = attemptCount >= MAX_ATTEMPTS ? 'failed' : 'pending';
            const lastError = error instanceof Error ? error.message : 'unknown';
            await this.prisma.eventOutbox.update({ where: { id: row.id }, data: { attemptCount, status, lastError } });
            if (status === 'failed') {
                this.logger.error('Outbox event failed permanently — needs an operator', undefined, {
                    eventId: row.id,
                    eventType: row.eventType,
                    lastError
                });
            }
            return status;
        }
    }
}
