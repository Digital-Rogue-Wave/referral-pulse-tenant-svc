import { context as otContext, trace, SpanStatusCode } from '@opentelemetry/api';
import type { Message } from '@aws-sdk/client-sqs';
import { baseSqsSpanAttrs, extractContextFromMessage } from '@mod/common/tracing/sqs.tracing';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import { ClsService } from 'nestjs-cls';
import { AppLoggingService } from '@mod/common/logger/app-logging.service';
import { EventIdempotencyService } from '@mod/common/idempotency/event-idempotency.service';
import { EventEnvelope } from '@mod/types/app.interface';

export interface SqsEventHandlerOptions {
    queue: string;
    consumerName: string;
}

export function SqsEventHandler(opts: SqsEventHandlerOptions) {
    return function (
        _target: unknown,
        _propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(message: Message) => Promise<void>>,
    ): TypedPropertyDescriptor<(message: Message) => Promise<void>> {
        const original = descriptor.value!;

        descriptor.value = async function (
            this: {
                metrics?: MonitoringService;
                eventIdempotency?: EventIdempotencyService;
                cls?: ClsService;
                logger?: AppLoggingService;
            },
            message: Message,
        ): Promise<void> {
            const tracer = trace.getTracer('sqs');
            const start = process.hrtime.bigint();
            const parentCtx = extractContextFromMessage(message);

            await otContext.with(parentCtx, async () => {
                const span = tracer.startSpan(`sqs.consume ${opts.queue}`, {
                    attributes: baseSqsSpanAttrs(opts.queue, message),
                });

                try {
                    const envelope: EventEnvelope = JSON.parse(message.Body || '{}');
                    const { metadata } = envelope;

                    // Set CLS context
                    if (this.cls) {
                        this.cls.set('tenantId', metadata.tenantId);
                        this.cls.set('userId', metadata.userId);
                        this.cls.set('eventId', metadata.eventId);
                        this.cls.set('requestId', metadata.requestId);
                    }

                    // Idempotency check
                    if (this.eventIdempotency) {
                        const isProcessed = await this.eventIdempotency.isProcessed(
                            metadata.eventId,
                            opts.consumerName,
                        );

                        if (isProcessed) {
                            this.logger?.info(
                                `SQS event already processed - eventId: ${metadata.eventId}, eventType: ${metadata.eventType}, consumerName: ${opts.consumerName}, requestId: ${metadata.requestId || 'none'}`,
                            );

                            span.addEvent('event_skipped_duplicate');
                            span.setStatus({ code: SpanStatusCode.OK });
                            return;
                        }
                    }

                    // Process event
                    await original.call(this, message);

                    // Mark as processed
                    if (this.eventIdempotency) {
                        await this.eventIdempotency.markProcessed(
                            metadata.eventId,
                            opts.consumerName,
                        );
                    }

                    span.setStatus({ code: SpanStatusCode.OK });
                } catch (e) {
                    span.recordException(e as Error);
                    span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error)?.message });
                    throw e;
                } finally {
                    span.end();
                    const seconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
                    const status = (span as any)?.status?.code === SpanStatusCode.ERROR ? 'error' : 'ok';
                    this.metrics?.observeSqsHandler(opts.queue, status, seconds);
                }
            });
        };

        return descriptor;
    };
}
