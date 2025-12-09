import { registerAs } from '@nestjs/config';

export type RetryConfig = {
    retries: number;
    baseDelayMs: number;
    retryOnStatuses: number[];
};

export type CircuitBreakerConfig = {
    timeoutMs: number;
    volumeThreshold: number;
    errorThresholdPercentage: number;
    resetTimeoutMs: number;
};

export type IntraServiceHttpConfig = {
    baseURL: string;
    timeoutMs: number;
    tenantHeaderName: string; // e.g., 'x-tenant-id'
    jwtHeaderName: string;    // e.g., 'authorization'
};

export type ThirdPartyHttpConfig = {
    baseURL?: string;
    timeoutMs: number;
    userAgent: string;
};

export type HttpClientConfig = {
    intra: IntraServiceHttpConfig;
    thirdParty: ThirdPartyHttpConfig;
    retry: {
        intra: RetryConfig;
        thirdParty: RetryConfig;
    };
    breaker: {
        intra: CircuitBreakerConfig;
        thirdParty: CircuitBreakerConfig;
    };
};

export default registerAs<HttpClientConfig>('httpClientConfig', () => ({
    intra: {
        baseURL: process.env.INTRA_HTTP_BASE_URL ?? 'http://localhost:3000',
        timeoutMs: Number(process.env.INTRA_HTTP_TIMEOUT_MS ?? 3000),
        tenantHeaderName: process.env.INTRA_TENANT_HEADER ?? 'x-tenant-id',
        jwtHeaderName: process.env.INTRA_JWT_HEADER_NAME ?? 'authorization',
    },
    thirdParty: {
        baseURL: process.env.TP_HTTP_BASE_URL || undefined,
        timeoutMs: Number(process.env.TP_HTTP_TIMEOUT_MS ?? 5000),
        userAgent: process.env.TP_HTTP_UA ?? 'our-service/1.0',
    },
    retry: {
        intra: {
            retries: Number(process.env.INTRA_HTTP_RETRIES ?? 3),
            baseDelayMs: Number(process.env.INTRA_HTTP_RETRY_BASE_DELAY_MS ?? 200),
            retryOnStatuses: (process.env.INTRA_HTTP_RETRY_STATUSES ?? '429,502,503,504')
                .split(',')
                .map((s) => Number(s.trim())),
        },
        thirdParty: {
            retries: Number(process.env.TP_HTTP_RETRIES ?? 2),
            baseDelayMs: Number(process.env.TP_HTTP_RETRY_BASE_DELAY_MS ?? 400),
            retryOnStatuses: (process.env.TP_HTTP_RETRY_STATUSES ?? '429,500,502,503,504')
                .split(',')
                .map((s) => Number(s.trim())),
        },
    },
    breaker: {
        intra: {
            timeoutMs: Number(process.env.INTRA_CB_TIMEOUT_MS ?? 2500),
            volumeThreshold: Number(process.env.INTRA_CB_VOLUME_THRESHOLD ?? 20),
            errorThresholdPercentage: Number(process.env.INTRA_CB_ERR_PCT ?? 50),
            resetTimeoutMs: Number(process.env.INTRA_CB_RESET_TIMEOUT_MS ?? 10000),
        },
        thirdParty: {
            timeoutMs: Number(process.env.TP_CB_TIMEOUT_MS ?? 3500),
            volumeThreshold: Number(process.env.TP_CB_VOLUME_THRESHOLD ?? 20),
            errorThresholdPercentage: Number(process.env.TP_CB_ERR_PCT ?? 50),
            resetTimeoutMs: Number(process.env.TP_CB_RESET_TIMEOUT_MS ?? 15000),
        },
    },
}));
