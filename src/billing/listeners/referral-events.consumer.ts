import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';
import { MessageProcessorService } from '@app/common/messaging';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import type { IMessageEnvelope } from '@app/types';
import { RedisUsageService } from '../redis-usage.service';
import { BillingEventEntity } from '../billing-event.entity';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@app/common';

interface ReferralUsageEvent {
    metric: string;
    delta: number;
    [key: string]: any;
}

@Injectable()
export class ReferralEventProcessor {
    constructor(
        private readonly messageProcessor: MessageProcessorService,
        private readonly logger: AppLoggerService,
        private readonly redisUsageService: RedisUsageService,
        @InjectTenantAwareRepository(BillingEventEntity)
        private readonly billingEvents: TenantAwareRepository<BillingEventEntity>
    ) {
        this.logger.setContext(ReferralEventProcessor.name);
    }

    @SqsMessageHandler('analytics-events', false)
    async handleEvent(message: Message): Promise<void> {
        await this.messageProcessor.process<ReferralUsageEvent>(
            message,
            async (envelope: IMessageEnvelope<ReferralUsageEvent>) => {
                const eventType = envelope.eventType || 'unknown';

                if (!eventType.startsWith('referral.')) {
                    this.logger.debug(`Skipping non-referral analytics event: ${eventType}`, {
                        messageId: envelope.messageId,
                    });
                    return;
                }

                const tenantId = envelope.tenantId;
                if (!tenantId) {
                    this.logger.warn(`Referral event missing tenantId - eventType: ${eventType}`, {
                        messageId: envelope.messageId,
                    });
                    return;
                }

                const metric = envelope.payload?.metric;
                const delta = envelope.payload?.delta;

                if (typeof metric !== 'string' || !Number.isFinite(delta)) {
                    this.logger.warn(`Invalid referral usage payload`, {
                        tenantId,
                        eventType,
                        metric: String(metric),
                        delta: String(delta),
                        messageId: envelope.messageId,
                    });
                    return;
                }

                const usage = await this.redisUsageService.trackUsage(tenantId, metric, delta);

                const billingEvent = this.billingEvents.create({
                    eventType,
                    metricName: metric,
                    increment: delta,
                    timestamp: new Date(envelope.timestamp || new Date().toISOString()),
                    metadata: {
                        ...(envelope.payload as any),
                        usageAfter: usage,
                        messageId: envelope.messageId,
                        correlationId: envelope.correlationId,
                    },
                });

                await this.billingEvents.save(billingEvent);

                this.logger.log(`Processed referral usage event`, {
                    tenantId,
                    eventType,
                    metric,
                    delta,
                    usageAfter: usage,
                    messageId: envelope.messageId,
                });
            },
            { queueName: 'analytics-events' },
        );
    }
}
