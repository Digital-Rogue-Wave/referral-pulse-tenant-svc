import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { Environment } from '@app/types';

const schema = z.object({
    enabled: z.preprocess((val) => val === 'true', z.boolean()).default(true),
    serviceName: z.string().min(1).default('referral-campaign-service'),
    serviceVersion: z.string().default('1.0.0'),
    environment: z.nativeEnum(Environment).default(Environment.Development),
    namespace: z.string().optional(),
    exporterEndpoint: z.string().url().optional(),
    tracesEndpoint: z.string().url().optional(),
    metricsEndpoint: z.string().url().optional(),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    samplingRatio: z.coerce.number().min(0).max(1).default(1),
    propagateB3: z.preprocess((val) => val === 'true', z.boolean()).default(true),
    propagateW3C: z.preprocess((val) => val === 'true', z.boolean()).default(true),
    maxExportBatchSize: z.coerce.number().int().positive().default(512),
    scheduledDelayMillis: z.coerce.number().int().positive().default(5000),
    exportTimeoutMillis: z.coerce.number().int().positive().default(30000),
    metricsExportInterval: z.coerce.number().int().positive().default(60000),
    // Grafana Cloud authentication
    grafanaUser: z.string().optional(),
    grafanaApiKey: z.string().optional(),
    // Loki configuration for log aggregation
    lokiEnabled: z.preprocess((val) => val === 'true', z.boolean()).default(false),
    lokiHost: z.string().optional(),
    lokiBasicAuth: z.string().optional(),
    lokiLabels: z.string().optional(),
    lokiBatchInterval: z.coerce.number().int().positive().default(5000),
});

export type TracingConfig = z.infer<typeof schema>;

export default registerAs('tracing', (): TracingConfig => {
    const result = schema.safeParse({
        enabled: process.env.OTEL_ENABLED,
        serviceName: process.env.OTEL_SERVICE_NAME,
        serviceVersion: process.env.OTEL_SERVICE_VERSION,
        environment: process.env.NODE_ENV,
        namespace: process.env.OTEL_SERVICE_NAMESPACE,
        exporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        tracesEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
        metricsEndpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
        logLevel: process.env.OTEL_LOG_LEVEL,
        samplingRatio: process.env.OTEL_SAMPLING_RATIO,
        propagateB3: process.env.OTEL_PROPAGATE_B3,
        propagateW3C: process.env.OTEL_PROPAGATE_W3C,
        maxExportBatchSize: process.env.OTEL_MAX_EXPORT_BATCH_SIZE,
        scheduledDelayMillis: process.env.OTEL_SCHEDULED_DELAY_MILLIS,
        exportTimeoutMillis: process.env.OTEL_EXPORT_TIMEOUT_MILLIS,
        metricsExportInterval: process.env.OTEL_METRICS_EXPORT_INTERVAL,
        grafanaUser: process.env.GRAFANA_CLOUD_USER,
        grafanaApiKey: process.env.GRAFANA_CLOUD_API_KEY,
        lokiEnabled: process.env.LOKI_ENABLED,
        lokiHost: process.env.LOKI_HOST,
        lokiBasicAuth: process.env.LOKI_BASIC_AUTH,
        lokiLabels: process.env.LOKI_LABELS,
        lokiBatchInterval: process.env.LOKI_BATCH_INTERVAL,
    });

    if (!result.success) {
        throw new Error(`Tracing config validation failed: ${result.error.message}`);
    }
    return result.data;
});
