import appConfig from './app.config';
import databaseConfig from './database.config';
import awsConfig from './aws.config';
import redisConfig from './redis.config';
import authConfig from './auth.config';
import tracingConfig from './tracing.config';
import httpConfig from './http.config';
import servicesConfig from './services.config';

export { AllConfigType } from './config.type';
export { AppConfig } from './app.config';
export { DatabaseConfig } from './database.config';
export { AwsConfig } from './aws.config';
export { RedisConfig } from './redis.config';
export { AuthConfig } from './auth.config';
export { TracingConfig } from './tracing.config';
export { HttpConfig } from './http.config';
export { ServicesConfig } from './services.config';

export const configLoaders = [
    appConfig,
    databaseConfig,
    awsConfig,
    redisConfig,
    authConfig,
    tracingConfig,
    httpConfig,
    servicesConfig,
];

export {
    appConfig,
    databaseConfig,
    awsConfig,
    redisConfig,
    authConfig,
    tracingConfig,
    httpConfig,
    servicesConfig,
};
