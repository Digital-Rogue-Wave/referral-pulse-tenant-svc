import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import type { AllConfigType } from '@app/config/config.type';
import type { IMessageEnvelope, IMessageMetadata, ClsRequestContext } from '@app/types';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { DateService } from '@app/common/helper/date.service';
import { JsonService } from '@app/common/helper/json.service';

/**
 * Service for creating and parsing message envelopes with tenant context.
 * All messages include tenant information for multi-tenancy support.
 */
@Injectable()
export class MessageEnvelopeService {
    private readonly serviceName: string;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: ClsTenantContextService,
        private readonly tracingService: TracingService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService,
        private readonly jsonService: JsonService,
    ) {
        this.logger.setContext(MessageEnvelopeService.name);
        this.serviceName = this.configService.getOrThrow('app.name', { infer: true });
    }

    /**
     * Create a message envelope with current tenant context.
     * REQUIRES active tenant context.
     *
     * @param eventType - Event type identifier
     * @param payload - Event payload
     * @param idempotencyKey - Optional idempotency key for deduplication.
     *                         Should be business-domain based (e.g., "order-${orderId}")
     *                         NOT auto-generated. If not provided, consumers will fall back
     *                         to messageId (limited deduplication).
     */
    createEnvelope<T>(eventType: string, payload: T, idempotencyKey?: string): IMessageEnvelope<T> {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId) {
            throw new Error('Tenant context is required for creating message envelopes');
        }

        const traceInfo = this.tracingService.getCurrentTraceInfo();
        const metadata: IMessageMetadata = {
            userId: this.tenantContext.getUserId(),
            traceId: traceInfo?.traceId,
            spanId: traceInfo?.spanId,
        };

        return {
            messageId: ulid(),
            eventType,
            version: '1.0',
            timestamp: this.dateService.nowISO(),
            source: this.serviceName,
            tenantId,
            correlationId: this.tenantContext.getCorrelationId() || ulid(),
            idempotencyKey,
            payload,
            metadata,
        };
    }

    /**
     * Create envelope for system messages (no tenant context required).
     *
     * @param eventType - Event type identifier
     * @param payload - Event payload
     * @param tenantId - Optional tenant ID for system messages
     * @param idempotencyKey - Optional idempotency key for deduplication
     */
    createSystemEnvelope<T>(
        eventType: string,
        payload: T,
        tenantId?: string,
        idempotencyKey?: string,
    ): IMessageEnvelope<T> {
        const traceInfo = this.tracingService.getCurrentTraceInfo();
        return {
            messageId: ulid(),
            eventType,
            version: '1.0',
            timestamp: this.dateService.nowISO(),
            source: this.serviceName,
            tenantId: tenantId || 'system',
            correlationId: ulid(),
            idempotencyKey,
            payload,
            metadata: {
                traceId: traceInfo?.traceId,
                spanId: traceInfo?.spanId,
            },
        };
    }

    /**
     * Parse a message body into an envelope using simdjson for performance.
     */
    parseEnvelope<T>(body: string): IMessageEnvelope<T> {
        const envelope = this.jsonService.parse<IMessageEnvelope<T>>(body);

        // Validate required fields
        if (!envelope.messageId || !envelope.eventType || !envelope.tenantId) {
            throw new Error('Invalid message envelope: missing required fields (messageId, eventType, tenantId)');
        }

        return envelope;
    }

    /**
     * Extract CLS context from envelope for setting up tenant context.
     */
    extractClsContext(envelope: IMessageEnvelope): Partial<ClsRequestContext> {
        return {
            tenantId: envelope.tenantId,
            userId: envelope.metadata?.userId || '',
            correlationId: envelope.correlationId,
            requestId: envelope.messageId,
            traceId: envelope.metadata?.traceId,
            spanId: envelope.metadata?.spanId,
            idempotencyKey: envelope.idempotencyKey,
        };
    }

    /**
     * Wrap a handler to run within tenant context from envelope.
     * Use this in your message handlers to ensure multi-tenancy.
     */
    async withTenantContext<T, R>(
        envelope: IMessageEnvelope<T>,
        handler: (payload: T, envelope: IMessageEnvelope<T>) => Promise<R>,
    ): Promise<R> {
        const context = this.extractClsContext(envelope);
        return this.tenantContext.runWithContext(context, async () => {
            return handler(envelope.payload, envelope);
        });
    }
}
