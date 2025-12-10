import { registerAs } from '@nestjs/config';

export type MetricsConfig = {
    enabled: boolean;
    endpoint: string; // path exposed by PrometheusModule, default '/metrics'
    defaultBuckets: number[];
};

export default registerAs<MetricsConfig>('metricsConfig', () => ({
    enabled: (process.env.METRICS_ENABLED ?? 'true') === 'true',
    endpoint: process.env.METRICS_ENDPOINT ?? '/metrics',
    defaultBuckets: (process.env.METRICS_BUCKETS ?? '0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10')
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n))
}));
