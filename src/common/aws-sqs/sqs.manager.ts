import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { SqsService } from '@ssut/nestjs-sqs';
import { randomUUID } from 'node:crypto';
import type { MessageAttributeValue } from '@aws-sdk/client-sqs';
import { EventEnvelope, EventMetadata, TenantContext } from '@mod/types/app.interface';
import { ProducerDef } from '@mod/types/app.type';
import { injectTraceAttributes } from '@mod/common/tracing/sqs.tracing';
import { AppLoggingService } from '@mod/common/logger/app-logging.service';
import sqsConfig from '@mod/config/sqs.config';
import { ClsService } from 'nestjs-cls';
import { EventIdempotencyService } from '@mod/common/idempotency/event-idempotency.service';

export interface SendEventOptions {
    producer: string;
    groupId?: string;
    delaySeconds?: number;
    correlationId?: string;  // ADD: For replies
    replyTo?: string;        // ADD: Queue to send reply to
}

@Injectable()
export class SqsManager {
    private readonly producers: ReadonlyArray<ProducerDef>;

    constructor(
        private readonly sqs: SqsService,
        private readonly logger: AppLoggingService,
        private readonly eventIdempotency: EventIdempotencyService,
        private readonly configService: ConfigService,
        private readonly cls: ClsService,
        @Optional() @Inject(TenantContext) private readonly tenant?: TenantContext,
    ) {
        const cfg = this.configService.getOrThrow<ConfigType<typeof sqsConfig>>('sqsConfig', { infer: true });
        this.producers = cfg.producers as ReadonlyArray<ProducerDef>;
    }

    private findProducer(name: string): ProducerDef {
        const queue = this.producers.find((p) => p.name === name);
        if (!queue) throw new Error(`[SQS] Unknown producer "${name}"`);
        return queue;
    }

    private getTenantId(): string {
        return this.tenant?.getTenantId?.() || this.cls.get('tenantId') || 'system';
    }

    private getUserId(): string | undefined {
        return this.cls.get('userId') as string | undefined;
    }

    private getRequestId(): string | undefined {
        return this.cls.get('requestId') as string | undefined;
    }

    private isFifo(def: ProducerDef): boolean {
        return Boolean(def.fifo) || def.queueUrl.endsWith('.fifo');
    }

    private buildEventEnvelope<T>(
        eventType: string,
        payload: T,
        causationId?: string,
    ): EventEnvelope<T> {
        const eventId = randomUUID();

        const metadata: EventMetadata = {
            eventId,
            eventType,
            tenantId: this.getTenantId(),
            userId: this.getUserId(),
            requestId: this.getRequestId(),
            causationId,
            timestamp: new Date().toISOString(),
            version: 'v1',
        };

        return { metadata, payload };
    }

    async sendEvent<T>(
        eventType: string,
        payload: T,
        options: SendEventOptions,
    ): Promise<string> {
        const def = this.findProducer(options.producer);
        const envelope = this.buildEventEnvelope(eventType, payload);
        const eventId = envelope.metadata.eventId;
        const tenantId = envelope.metadata.tenantId;
        const requestId = envelope.metadata.requestId;

        // Check if already sent
        if (await this.eventIdempotency.wasSent(eventId, def.name)) {
            this.logger.warn(
                `SQS event already sent - eventId: ${eventId}, eventType: ${eventType}, producer: ${def.name}, tenantId: ${tenantId}`,
            );
            return eventId;
        }

        const messageAttributes: Record<string, MessageAttributeValue> = {
            eventType: { DataType: 'String', StringValue: eventType },
            eventId: { DataType: 'String', StringValue: eventId },
            tenantId: { DataType: 'String', StringValue: tenantId },
        };

        if (envelope.metadata.userId) {
            messageAttributes.userId = { DataType: 'String', StringValue: envelope.metadata.userId };
        }

        if (requestId) {
            messageAttributes.requestId = { DataType: 'String', StringValue: requestId };
        }

        injectTraceAttributes(messageAttributes);

        const body = JSON.stringify(envelope);

        if (this.isFifo(def)) {
            const groupId = options.groupId || tenantId;
            const deduplicationId = eventId;

            this.logger.info(
                `SQS publish event - queue: ${def.name}, eventType: ${eventType}, eventId: ${eventId}, requestId: ${requestId || 'none'}, fifo: true, groupId: ${groupId}, tenantId: ${tenantId}`,
            );

            await this.sqs.send(def.name, {
                id: eventId,
                body,
                messageAttributes,
                groupId,
                deduplicationId,
                delaySeconds: options.delaySeconds,
            });
        } else {
            this.logger.info(
                `SQS publish event - queue: ${def.name}, eventType: ${eventType}, eventId: ${eventId}, requestId: ${requestId || 'none'}, fifo: false, tenantId: ${tenantId}`,
            );

            await this.sqs.send(def.name, {
                id: eventId,
                body,
                messageAttributes,
                delaySeconds: options.delaySeconds,
            });
        }

        await this.eventIdempotency.markSent(eventId, def.name);

        return eventId;
    }

    async sendEventBatch<T>(
        events: Array<{ eventType: string; payload: T; groupId?: string }>,
        producer: string,
    ): Promise<string[]> {
        if (events.length === 0) return [];
        if (events.length > 10) throw new Error('[SQS] sendEventBatch max 10 messages');

        const eventIds: string[] = [];

        for (const event of events) {
            const eventId = await this.sendEvent(event.eventType, event.payload, {
                producer,
                groupId: event.groupId,
            });
            eventIds.push(eventId);
        }

        const tenantId = this.getTenantId();
        this.logger.info(
            `SQS publish event batch - producer: ${producer}, count: ${events.length}, tenantId: ${tenantId}`,
        );

        return eventIds;
    }
}
