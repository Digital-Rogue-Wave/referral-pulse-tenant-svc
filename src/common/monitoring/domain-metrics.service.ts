import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Counter } from '@opentelemetry/api';

import { MetricsService } from './metrics.service';

/**
 * Business metrics of tenant-service (Failure & Observability v3: every critical flow is observable).
 * Alert on: `tenant_outbox_pending_oldest_seconds` growing, any `tenant_outbox_failed_total`,
 * `tenant_deletions_total{result="failed"}`, `stripe_events` left `failed` (billing_subscription_events_total
 * with result=error).
 */
@Injectable()
export class DomainMetrics implements OnModuleInit {
    private outboxPublished!: Counter;
    private outboxFailed!: Counter;
    private deletions!: Counter;
    private dunning!: Counter;
    private limitRejections!: Counter;
    private erasures!: Counter;
    private outboxBacklog = { pending: 0, oldestSeconds: 0 };

    constructor(private readonly metrics: MetricsService) {}

    onModuleInit(): void {
        this.outboxPublished = this.metrics.createCounter('tenant_outbox_published_total', { description: 'Events published to tenant-events' });
        this.outboxFailed = this.metrics.createCounter('tenant_outbox_failed_total', { description: 'Events that exhausted their publish attempts' });
        this.deletions = this.metrics.createCounter('tenant_deletions_total', { description: 'Tenant deletion saga runs by result' });
        this.dunning = this.metrics.createCounter('billing_dunning_escalations_total', {
            description: 'Payment status escalations by target status'
        });
        this.limitRejections = this.metrics.createCounter('usage_limit_rejections_total', { description: 'Requests refused by a plan limit' });
        this.erasures = this.metrics.createCounter('dsr_operator_erasures_total', { description: 'Operator erasure requests by receipt status' });
        this.metrics
            .createGauge('tenant_outbox_pending', { description: 'Outbox rows waiting to be published' })
            .addCallback((result) => result.observe(this.outboxBacklog.pending));
        this.metrics
            .createGauge('tenant_outbox_pending_oldest_seconds', { description: 'Age of the oldest unpublished outbox row', unit: 's' })
            .addCallback((result) => result.observe(this.outboxBacklog.oldestSeconds));
    }

    outboxRun(published: number, failed: number, backlog: { pending: number; oldestCreatedAt: Date | null }): void {
        this.outboxPublished?.add(published);
        this.outboxFailed?.add(failed);
        this.outboxBacklog = {
            pending: backlog.pending,
            oldestSeconds: backlog.oldestCreatedAt ? Math.round((Date.now() - backlog.oldestCreatedAt.getTime()) / 1000) : 0
        };
    }

    tenantDeletion(result: 'deleted' | 'failed'): void {
        this.deletions?.add(1, { result });
    }

    dunningEscalation(to: string): void {
        this.dunning?.add(1, { to });
    }

    limitRejected(metric: string): void {
        this.limitRejections?.add(1, { metric });
    }

    erasure(status: string): void {
        this.erasures?.add(1, { status });
    }
}
