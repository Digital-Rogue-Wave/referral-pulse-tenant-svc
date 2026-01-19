/**
 * Centralized configuration exports
 * Import all configurations in one place for cleaner module imports
 */

import appConfig from './app.config';
import awsConfig from './aws.config';
import cacheConfig from './cache.config';
import databaseConfig from './database.config';
import httpClientConfig from './http-client.config';
import loggerConfig from './logger.config';
import metricsConfig from './metrics.config';
import oryConfig from './ory.config';
import redisConfig from './redis.config';
import s3Config from './s3.config';
import servicesConfig from './services.config';
import snsConfig from './sns.config';
import sqsConfig from './sqs.config';
import stripeConfig from './stripe.config';
import tracingConfig from './tracing.config';
import billingConfig from './billing.config';

// Re-export individual configs
export {
    appConfig,
    awsConfig,
    cacheConfig,
    databaseConfig,
    httpClientConfig,
    loggerConfig,
    metricsConfig,
    oryConfig,
    redisConfig,
    s3Config,
    servicesConfig,
    snsConfig,
    sqsConfig,
    stripeConfig,
    tracingConfig,
    billingConfig
};

/**
 * Array of all configuration loaders for easy use in ConfigModule
 * Usage: ConfigModule.forRoot({ load: allConfigs })
 */
export const allConfigs = [
    appConfig,
    awsConfig,
    cacheConfig,
    databaseConfig,
    httpClientConfig,
    loggerConfig,
    metricsConfig,
    oryConfig,
    redisConfig,
    s3Config,
    servicesConfig,
    snsConfig,
    sqsConfig,
    stripeConfig,
    tracingConfig,
    billingConfig
];
