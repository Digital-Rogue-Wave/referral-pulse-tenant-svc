import type { AppConfig } from "./app.config";
import type { AuthConfig } from "./auth.config";
import type { AwsConfig } from "./aws.config";
import type { BillingConfig } from "./billing.config";
import type { ClickHouseConfig } from "./clickhouse.config";
import type { DatabaseConfig } from "./database.config";
import type { HttpConfig } from "./http.config";
import type { OryConfig } from "./ory.config";
import type { RedisConfig } from "./redis.config";
import type { ResilienceConfig } from "./resilience.config";
import type { ServicesConfig } from "./services.config";
import type { StripeConfig } from "./stripe.config";
import type { TemporalConfig } from "./temporal.config";
import type { TracingConfig } from "./tracing.config";

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
  resilience: ResilienceConfig;
  services: ServicesConfig;
  oryConfig: OryConfig;
  clickhouse: ClickHouseConfig;
  temporal: TemporalConfig;
  billingConfig: BillingConfig;
  stripeConfig: StripeConfig;
}
