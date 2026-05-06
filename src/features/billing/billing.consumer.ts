import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';

import { ANALYTICS_SVC_FIFO } from '@app/types';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import { MessageProcessorService } from '@common/messaging/message-processor.service';
import { SqsConsumer } from '@common/messaging/sqs-consumer.decorator';

import { ReferralUsageEvent } from '@domains/billing';

@Injectable()
export class BillingConsumer {
    constructor(
        private readonly messageProcessor: MessageProcessorService,
        private readonly prisma: DatabaseService,
        private readonly redis: RedisService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(BillingConsumer.name);
    }

    @SqsConsumer({ queueName: ANALYTICS_SVC_FIFO })
    @SqsMessageHandler(ANALYTICS_SVC_FIFO, false)
    async handleReferralUsageEvent(message: Message): Promise<void> {
        await this.messageProcessor.process<ReferralUsageEvent>(
            message,
            async (envelope) => {
                const { eventType, payload, tenantId } = envelope;

                if (!eventType.startsWith('referral.')) {
                    this.logger.debug(`Skipping non-referral analytics event: ${eventType}`);
                    return;
                }

                const { metric, delta } = payload;

                if (typeof metric !== 'string' || !Number.isFinite(delta)) {
                    this.logger.warn(
                        `Invalid referral usage payload for tenant ${tenantId} - eventType: ${eventType}`,
                    );
                    return;
                }

                const usage = await this.redis.trackUsage(metric, delta);

                await this.prisma.billingEvent.create({
                    data: {
                        tenantId,
                        eventType,
                        metricName: metric,
                        increment: delta,
                        timestamp: new Date(),
                        metadata: { ...payload, usageAfter: usage },
                    },
                });

                this.logger.log(`Processed referral usage event`, { tenantId, metric, delta });
            },
            { queueName: ANALYTICS_SVC_FIFO },
        );
    }
}
