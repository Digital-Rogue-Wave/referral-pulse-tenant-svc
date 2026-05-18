import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';

import { type IMessageEnvelope, ANALYTICS_SVC_FIFO } from '@app/types';

import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { JsonService } from '@common/helper/json.service';
import { RedisService } from '@common/redis/redis.service';
import { SqsConsumer } from '@common/messaging/sqs-consumer.decorator';
import { ReferralUsageEvent } from '@app/domains';

@Injectable()
export class ReferralEventProcessor {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService,
        private readonly jsonService: JsonService,
        private readonly redis: RedisService,
    ) {
        this.logger.setContext(ReferralEventProcessor.name);
    }

    @SqsMessageHandler(ANALYTICS_SVC_FIFO, false)
    @SqsConsumer({
        queueName: ANALYTICS_SVC_FIFO,
    })
    async handleEvent(message: Message): Promise<void> {
        if (!message.Body) {
            this.logger.warn('Received SQS message with empty body, skipping');
            return;
        }

        const envelope: IMessageEnvelope<ReferralUsageEvent> = this.jsonService.parse(message.Body);
        const { payload } = envelope;

        const eventType = envelope.eventType || 'unknown';

        if (!eventType.startsWith('referral.')) {
            this.logger.debug(`Skipping non-referral analytics event: ${eventType}`);
            return;
        }

        const tenantId = envelope.tenantId;
        if (!tenantId) {
            this.logger.warn(`Referral event missing tenantId - eventType: ${eventType}`);
            return;
        }

        const metric = payload?.metric;
        const delta = payload?.delta;

        if (typeof metric !== 'string' || !Number.isFinite(delta)) {
            this.logger.warn(
                `Invalid referral usage payload for tenant ${tenantId} - eventType: ${eventType}, metric: ${String(metric)}, delta: ${String(delta)}`,
            );
            return;
        }

        await this.tenantContext.runWithContext({ tenantId }, async () => {
            const usage = await this.redis.trackUsage(metric, delta);

            await this.prisma.billingEvent.create({
                data: {
                    tenantId,
                    eventType,
                    metricName: metric,
                    increment: delta,
                    timestamp: new Date(envelope.timestamp || new Date().toISOString()),
                    metadata: {
                        ...payload,
                        usageAfter: usage,
                    },
                },
            });

            this.logger.log(
                `Processed referral usage event - tenantId: ${tenantId}, eventType: ${eventType}, metric: ${metric}, delta: ${delta}, usageAfter: ${usage}`,
            );
        });
    }
}
