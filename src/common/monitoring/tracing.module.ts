import { Global, Module, OnModuleDestroy, OnModuleInit, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { trace, SpanKind, SpanStatusCode, Tracer, Span } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource, resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { B3Propagator, B3InjectEncoding } from '@opentelemetry/propagator-b3';
import { W3CTraceContextPropagator, CompositePropagator } from '@opentelemetry/core';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import type { AllConfigType } from '@app/config/config.type';
import type { ISpanAttributes } from '@app/types';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { MetricsService } from './metrics.service';
import { MessagingMetricsService } from './messaging-metrics.service';
import { HttpMetricsService } from './http-metrics.service';

/**
 * TracingService with Grafana Cloud integration.
 * Exports traces to Tempo and metrics to Mimir/Prometheus via OTLP.
 */

@Injectable()
export class TracingService implements OnModuleInit, OnModuleDestroy {
    private sdk: NodeSDK | undefined;
    private tracer: Tracer | undefined;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(TracingService.name);
    }

    async onModuleInit(): Promise<void> {
        const enabled = this.configService.getOrThrow('tracing.enabled', { infer: true });
        const tracesEndpoint = this.configService.get('tracing.tracesEndpoint', { infer: true });

        if (!enabled || !tracesEndpoint) {
            this.logger.log('Tracing disabled or no endpoint configured');
            return;
        }

        const serviceName = this.configService.getOrThrow('tracing.serviceName', { infer: true });
        const serviceVersion = this.configService.getOrThrow('tracing.serviceVersion', { infer: true });
        const environment = this.configService.getOrThrow('tracing.environment', { infer: true });

        this.logger.log(`Initializing OpenTelemetry for ${serviceName} v${serviceVersion} (env: ${environment})`);

        // Resource attributes for all telemetry
        const resource: Resource = resourceFromAttributes({
            [ATTR_SERVICE_NAME]: serviceName,
            [ATTR_SERVICE_VERSION]: serviceVersion,
            'deployment.environment': environment,
            'service.namespace': this.configService.get('tracing.namespace', { infer: true }) || 'default',
        });

        // Configure trace propagation
        const propagators: (B3Propagator | W3CTraceContextPropagator)[] = [];
        if (this.configService.getOrThrow('tracing.propagateB3', { infer: true })) {
            propagators.push(new B3Propagator({ injectEncoding: B3InjectEncoding.MULTI_HEADER }));
        }
        if (this.configService.getOrThrow('tracing.propagateW3C', { infer: true })) {
            propagators.push(new W3CTraceContextPropagator());
        }

        // Grafana Cloud authentication (if configured)
        const grafanaUser = this.configService.get('tracing.grafanaUser', { infer: true });
        const grafanaApiKey = this.configService.get('tracing.grafanaApiKey', { infer: true });
        const authHeaders: Record<string, string> | undefined =
            grafanaUser && grafanaApiKey
                ? { Authorization: `Basic ${Buffer.from(`${grafanaUser}:${grafanaApiKey}`).toString('base64')}` }
                : undefined;

        // Trace exporter (Grafana Cloud Tempo)
        const traceExporter = new OTLPTraceExporter({
            url: tracesEndpoint,
            headers: authHeaders,
        });

        // Metrics exporter (Grafana Cloud Mimir/Prometheus) - optional
        const metricsEndpoint = this.configService.get('tracing.metricsEndpoint', { infer: true });
        const metricReaders = metricsEndpoint
            ? [
                  new PeriodicExportingMetricReader({
                      exporter: new OTLPMetricExporter({
                          url: metricsEndpoint,
                          headers: authHeaders,
                      }),
                      exportIntervalMillis: this.configService.get('tracing.metricsExportInterval', { infer: true }) || 60000,
                  }),
              ]
            : [];

        if (metricsEndpoint) {
            this.logger.log(`Metrics export enabled to ${metricsEndpoint}`);
        }

        // Initialize NodeSDK with traces and metrics
        this.sdk = new NodeSDK({
            resource,
            traceExporter,
            metricReader: metricReaders.length > 0 ? metricReaders[0] : undefined,
            textMapPropagator: new CompositePropagator({ propagators }),
            instrumentations: [
                new HttpInstrumentation({
                    ignoreIncomingRequestHook: (req) => {
                        const url = req.url || '';
                        return /^\/(health|metrics|ready|live)/.test(url);
                    },
                }),
                new ExpressInstrumentation(),
                new PgInstrumentation(),
                new IORedisInstrumentation(),
                new AwsInstrumentation({ suppressInternalInstrumentation: true }),
            ],
        });

        await this.sdk.start();
        this.tracer = trace.getTracer(serviceName, serviceVersion);
        this.logger.log(`OpenTelemetry SDK started - traces: ${tracesEndpoint}`);
    }

    async onModuleDestroy(): Promise<void> {
        if (this.sdk) {
            this.logger.log('Shutting down OpenTelemetry SDK...');
            await this.sdk.shutdown();
            this.logger.log('OpenTelemetry SDK shut down');
        }
    }

    getTracer(): Tracer {
        return this.tracer || trace.getTracer('noop');
    }

    getCurrentTraceInfo(): { traceId: string; spanId: string } | undefined {
        const span = trace.getActiveSpan();
        if (!span) return undefined;
        const ctx = span.spanContext();
        return { traceId: ctx.traceId, spanId: ctx.spanId };
    }

    async withSpan<T>(
        name: string,
        fn: (span: Span) => Promise<T>,
        attributes?: ISpanAttributes,
    ): Promise<T> {
        const tracer = this.getTracer();
        return tracer.startActiveSpan(
            name,
            { kind: SpanKind.INTERNAL, attributes: attributes as Record<string, string | number | boolean> },
            async (span) => {
                try {
                    const result = await fn(span);
                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                } catch (error) {
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error instanceof Error ? error.message : 'Unknown error',
                    });
                    span.recordException(error as Error);
                    throw error;
                } finally {
                    span.end();
                }
            },
        );
    }

    addSpanAttributes(attributes: ISpanAttributes): void {
        const span = trace.getActiveSpan();
        if (span) {
            span.setAttributes(attributes as Record<string, string | number | boolean>);
        }
    }

    recordException(error: Error, message?: string): void {
        const span = trace.getActiveSpan();
        if (span) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: message || error.message });
        }
    }
}

@Global()
@Module({
    providers: [TracingService, MetricsService, MessagingMetricsService, HttpMetricsService],
    exports: [TracingService, MetricsService, MessagingMetricsService, HttpMetricsService],
})
export class TracingModule {}
