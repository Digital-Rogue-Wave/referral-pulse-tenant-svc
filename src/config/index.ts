import appConfig from './app.config';
import authConfig from './auth.config';
import awsConfig from './aws.config';
import billingConfig from './billing.config';
import clickhouseConfig from './clickhouse.config';
import databaseConfig from './database.config';
import httpConfig from './http.config';
import oryConfig from './ory.config';
import redisConfig from './redis.config';
import resilienceConfig from './resilience.config';
import servicesConfig from './services.config';
import stripeConfig from './stripe.config';
import temporalConfig from './temporal.config';
import tracingConfig from './tracing.config';

export type { AllConfigType } from './config.type';
export type { AppConfig } from './app.config';
export type { DatabaseConfig } from './database.config';
export type { AwsConfig } from './aws.config';
export type { RedisConfig } from './redis.config';
export type { AuthConfig } from './auth.config';
export type { TracingConfig } from './tracing.config';
export type { HttpConfig } from './http.config';
export type { ResilienceConfig } from './resilience.config';
export type { ServicesConfig } from './services.config';
export type { OryConfig } from './ory.config';
export type { ClickHouseConfig } from './clickhouse.config';
export type { TemporalConfig } from './temporal.config';
export type { BillingConfig } from './billing.config';
export type { StripeConfig } from './stripe.config';

export const configLoaders = [
    appConfig,
    databaseConfig,
    awsConfig,
    redisConfig,
    authConfig,
    tracingConfig,
    httpConfig,
    resilienceConfig,
    servicesConfig,
    oryConfig,
    clickhouseConfig,
    temporalConfig,
    billingConfig,
    stripeConfig
];

export {
    appConfig,
    databaseConfig,
    awsConfig,
    redisConfig,
    authConfig,
    tracingConfig,
    httpConfig,
    resilienceConfig,
    servicesConfig,
    oryConfig,
    clickhouseConfig,
    temporalConfig,
    billingConfig,
    stripeConfig
};
