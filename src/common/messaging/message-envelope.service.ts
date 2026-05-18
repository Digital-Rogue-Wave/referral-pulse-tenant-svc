import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ulid } from 'ulid';
import { z } from 'zod';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { RequestContext, IMessageEnvelope, IMessageMetadata } from '@app/types';

import { DateService } from '@common/helper/date.service';
import { JsonService } from '@common/helper/json.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';

/**
 * Message envelope schema for validation
 * Enforces mandatory fields for traceability and multi-tenancy
 */
const envelopeSchema = z.object({
    messageId: z.string().min(1, 'messageId is required'),
    eventType: z.string().min(1, 'eventType is required'),
    version: z.string().default('1.0'),
    timestamp: z.string().min(1, 'timestamp is required'),
    source: z.string().min(1, 'source is required'),
    tenantId: z.string().min(1, 'tenantId is required'),
    correlationId: z.string().min(1, 'correlationId is required'),
    idempotencyKey: z.string().optional(),
    payload: z.unknown(),
    metadata: z.object({
        userId: z.string().min(1, 'userId is required'),
        traceId: z.string().min(1, 'traceId is required'),
        spanId: z.string().optional(),
    }),
});

/**
 * Schema for system messages (no userId required)
 */
const systemEnvelopeSchema = envelopeSchema.extend({
    metadata: z.object({
        userId: z.string().optional(),
        traceId: z.string().optional(),
        spanId: z.string().optional(),
    }),
});

/**
 * Service for creating and parsing message envelopes with tenant context.
 * All messages include tenant information for multi-tenancy support.
 */
@Injectable()
export class MessageEnvelopeService {
    private readonly serviceName: string;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: TenantContextService,
        private readonly tracingService: TracingService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService,
        private readonly jsonService: JsonService,
    ) {
        this.logger.setContext(MessageEnvelopeService.name);
        this.serviceName = this.configService.getOrThrow('app.name', {
            infer: true,
        });
    }

    /**
     * Create a message envelope with current tenant context.
     * REQUIRES active tenant context with tenantId, userId, and traceId.
     *
     * @param eventType - Event type identifier
     * @param payload - Event payload
     * @param idempotencyKey - Optional idempotency key for deduplication.
     *                         Should be business-domain based (e.g., "order-${orderId}")
     *                         NOT auto-generated. If not provided, consumers will fall back
     *                         to messageId (limited deduplication).
     * @throws Error if required context (tenantId, userId, traceId) is missing
     */
    createEnvelope<T>(eventType: string, payload: T, idempotencyKey?: string): IMessageEnvelope<T> {
        const tenantId = this.tenantContext.getTenantId();
        const userId = this.tenantContext.getUserId();
        const correlationId = this.tenantContext.getCorrelationId();
        const traceInfo = this.tracingService.getCurrentTraceInfo();

        // Validate required context
        if (!tenantId) {
            throw new Error('Tenant context is required: tenantId missing');
        }
        if (!userId) {
            throw new Error('Tenant context is required: userId missing');
        }
        if (!correlationId) {
            throw new Error('Tenant context is required: correlationId missing');
        }

        // Generate traceId if not present (for non-traced requests)
        const traceId = traceInfo?.traceId || this.tenantContext.getTraceId() || ulid();

        const envelope: IMessageEnvelope<T> = {
            messageId: ulid(),
            eventType,
            version: '1.0',
            timestamp: this.dateService.nowISO(),
            source: this.serviceName,
            tenantId,
            correlationId,
            idempotencyKey,
            payload,
            metadata: {
                userId,
                traceId,
                spanId: traceInfo?.spanId,
            },
        };

        // Validate the envelope before returning
        const result = envelopeSchema.safeParse(envelope);
        if (!result.success) {
            const errors = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
            throw new Error(`Invalid message envelope: ${errors}`);
        }

        return envelope;
    }

    /**
     * Create envelope for system messages (no user context required).
     * Used for system-level events, maintenance, and cross-tenant operations.
     *
     * @param eventType - Event type identifier
     * @param payload - Event payload
     * @param tenantId - Tenant ID (defaults to 'system' for system-wide messages)
     * @param idempotencyKey - Optional idempotency key for deduplication
     */
    createSystemEnvelope<T>(
        eventType: string,
        payload: T,
        tenantId?: string,
        idempotencyKey?: string,
    ): IMessageEnvelope<T> {
        const traceInfo = this.tracingService.getCurrentTraceInfo();

        const envelope: IMessageEnvelope<T> = {
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
                userId: 'system',
                traceId: traceInfo?.traceId || ulid(),
                spanId: traceInfo?.spanId,
            },
        };

        // Validate the system envelope
        const result = systemEnvelopeSchema.safeParse(envelope);
        if (!result.success) {
            const errors = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
            throw new Error(`Invalid system message envelope: ${errors}`);
        }

        return envelope;
    }

    /**
     * Parse a message body into an envelope using simdjson for performance.
     * Validates all required fields including traceability context.
     * @throws Error if envelope is invalid or missing required fields
     */
    parseEnvelope<T>(body: string): IMessageEnvelope<T> {
        const parsed = this.jsonService.parse<unknown>(body);

        // Validate envelope structure
        const result = envelopeSchema.safeParse(parsed);
        if (!result.success) {
            const errors = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
            throw new Error(`Invalid message envelope: ${errors}`);
        }

        return result.data as IMessageEnvelope<T>;
    }

    /**
     * Extract ALS context from envelope for setting up tenant context.
     */
    extractRequestContext(envelope: IMessageEnvelope): Partial<RequestContext> {
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
        const context = this.extractRequestContext(envelope);
        return this.tenantContext.runWithContext(context, async () => {
            return handler(envelope.payload, envelope);
        });
    }
}
