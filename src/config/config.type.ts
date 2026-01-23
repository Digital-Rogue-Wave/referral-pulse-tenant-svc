import type { AppConfig } from './app.config';
import type { DatabaseConfig } from './database.config';
import type { AwsConfig } from './aws.config';
import type { RedisConfig } from './redis.config';
import type { AuthConfig } from './auth.config';
import type { TracingConfig } from './tracing.config';
import type { HttpConfig } from './http.config';
import type { ServicesConfig } from './services.config';

/**
 * Aggregated configuration type for type-safe config access.
 *
 * @example
 * this.configService.getOrThrow('app.port', { infer: true })
 */
export interface AllConfigType {
    app: AppConfig;
    database: DatabaseConfig;
    aws: AwsConfig;
    redis: RedisConfig;
    auth: AuthConfig;
    tracing: TracingConfig;
    http: HttpConfig;
    services: ServicesConfig;
}
