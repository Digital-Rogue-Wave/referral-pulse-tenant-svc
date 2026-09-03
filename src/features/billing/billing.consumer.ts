import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';

import { TENANT_SVC_FIFO } from '@app/types';

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
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(BillingConsumer.name);
    }

    @SqsConsumer({ queueName: TENANT_SVC_FIFO })
    @SqsMessageHandler(TENANT_SVC_FIFO, false)
    async handleReferralUsageEvent(message: Message): Promise<void> {
        await this.messageProcessor.process<ReferralUsageEvent>(
            message,
            async (envelope) => {
                const { eventType, payload, tenantId } = envelope;

                if (!eventType.startsWith('referral.')) {
                    this.logger.debug(`Skipping non-referral analytics event: ${eventType}`);
                    return;
                }

                // Defensive: accept metric/delta nested under payload OR at the envelope root.
                // Sibling producers are still in dev; ReferralUsageEvent carries metric/delta at the
                // event top level, while our envelope nests the event under `payload` (see NOTE.md).
                const usagePayload = (payload ?? {}) as Record<string, unknown>;
                const envelopeRoot = envelope as unknown as Record<string, unknown>;
                const metric = usagePayload.metric ?? envelopeRoot.metric;
                const delta = usagePayload.delta ?? envelopeRoot.delta;

                if (typeof metric !== 'string' || typeof delta !== 'number' || !Number.isFinite(delta)) {
                    this.logger.warn(`Invalid referral usage payload for tenant ${tenantId} - eventType: ${eventType}`);
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
                        metadata: { ...usagePayload, usageAfter: usage }
                    }
                });

                this.logger.log(`Processed referral usage event`, { tenantId, metric, delta });
            },
            { queueName: TENANT_SVC_FIFO }
        );
    }
}
