import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';
import { AppLoggingService } from '@mod/common/logger/app-logging.service';
import { SqsEventHandler } from '@mod/common/aws-sqs/sqs-event-handler.decorator';
import type { EventEnvelope } from '@mod/types/app.interface';
import { RedisUsageService } from '../redis-usage.service';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { BillingEventEntity } from '../billing-event.entity';

interface ReferralUsageEvent {
    metric: string;
    delta: number;
    [key: string]: any;
}

@Injectable()
export class ReferralEventProcessor {
    constructor(
        private readonly logger: AppLoggingService,
        private readonly redisUsageService: RedisUsageService,
        @InjectTenantAwareRepository(BillingEventEntity)
        private readonly billingEvents: TenantAwareRepository<BillingEventEntity>
    ) {}

    @SqsMessageHandler('analytics-events', false)
    @SqsEventHandler({ queue: 'analytics-events', consumerName: 'referral-events-processor' })
    async handleEvent(message: Message): Promise<void> {
        const envelope: EventEnvelope<ReferralUsageEvent> = JSON.parse(message.Body || '{}');
        const { metadata, payload } = envelope;

        const eventType = metadata?.eventType || 'unknown';

        if (!eventType.startsWith('referral.')) {
            this.logger.debug?.(`Skipping non-referral analytics event: ${eventType}`);
            return;
        }

        const tenantId = metadata.tenantId;
        if (!tenantId) {
            this.logger.warn(`Referral event missing tenantId in metadata - eventType: ${eventType}`);
            return;
        }

        const metric = payload?.metric;
        const delta = payload?.delta;

        if (typeof metric !== 'string' || !Number.isFinite(delta)) {
            this.logger.warn(
                `Invalid referral usage payload for tenant ${tenantId} - eventType: ${eventType}, metric: ${String(metric)}, delta: ${String(delta)}`
            );
            return;
        }

        const usage = await this.redisUsageService.trackUsage(tenantId, metric, delta);

        const billingEvent = this.billingEvents.createTenantContext({
            eventType,
            metricName: metric,
            increment: delta,
            timestamp: new Date(metadata.timestamp || new Date().toISOString()),
            metadata: {
                ...payload,
                usageAfter: usage
            }
        });

        await this.billingEvents.saveTenantContext(billingEvent);

        this.logger.info(
            `Processed referral usage event - tenantId: ${tenantId}, eventType: ${eventType}, metric: ${metric}, delta: ${delta}, usageAfter: ${usage}`
        );
    }
}
