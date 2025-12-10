import { AppConfig } from '@mod/config/app.config';
import { DatabaseConfig } from '@mod/config/database.config';
import { OryConfig } from '@mod/config/ory.config';
import { RedisConfig } from '@mod/config/redis.config';
import { MetricsConfig } from '@mod/config/metrics.config';
import { AwsConfig } from '@mod/config/aws.config';
import { HttpClientConfig } from '@mod/config/http-client.config';
import { LoggerConfig } from '@mod/config/logger.config';
import { S3Config } from '@mod/config/s3.config';
import { SqsConfig } from '@mod/config/sqs.config';
import { SnsConfig } from '@mod/config/sns.config';
import { TracingConfig } from '@mod/config/tracing.config';

export type AllConfigType = {
    appConfig: AppConfig;
    databaseConfig: DatabaseConfig;
    oryConfig: OryConfig;
    redisConfig: RedisConfig;
    loggerConfig: LoggerConfig;
    metricsConfig: MetricsConfig;
    tracingConfig: TracingConfig;
    httpClientConfig: HttpClientConfig;
    awsConfig: AwsConfig;
    s3Config: S3Config;
    sqsConfig: SqsConfig;
    snsConfig: SnsConfig;
};
