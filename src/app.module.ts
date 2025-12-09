// NestJs built-in imports
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// typeorm related imports
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmConfigService } from './database/typeorm-config.service';
import { HealthModule } from '@mod/health/health.module';

// created config-files imports
import databaseConfig from './config/database.config';
import appConfig from '@mod/config/app.config';
import awsConfig from '@mod/config/aws.config';
import oryConfig from '@mod/config/ory.config';
// created validators-files imports
import { ClsModule } from 'nestjs-cls';
import { TerminusModule } from '@nestjs/terminus';
import { HttpMetricsInterceptor } from '@mod/common/monitoring/http-metrics.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TracingEnrichmentInterceptor } from '@mod/common/tracing/tracing.interceptor';
import tracingConfig from '@mod/config/tracing.config';
import metricsConfig from '@mod/config/metrics.config';
import s3Config from '@mod/config/s3.config';
import sqsConfig from '@mod/config/sqs.config';
import snsConfig from '@mod/config/sns.config';
import redisConfig from '@mod/config/redis.config';
import { CommonModule } from '@mod/common/common.module';
import { TransactionalOrmModule } from '@mod/database/transactional-orm.module';
import { IdempotencyModule } from '@mod/common/idempotency/idempotency.module';
import { RequestIdMiddleware } from '@mod/common/middleware/request-id.middleware';
import { HttpLoggingInterceptor } from '@mod/common/logger/http-logging.interceptor';
import { RpcLoggingInterceptor } from '@mod/common/logger/rpc-logging.interceptor';
import { WebhookModule } from './webhook/webhook.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [databaseConfig, appConfig, redisConfig, awsConfig, oryConfig, tracingConfig, metricsConfig, s3Config, sqsConfig, snsConfig],
            envFilePath: ['.env']
        }),
        ClsModule.forRoot({ global: true, middleware: { mount: true, generateId: true } }),
        TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
        IdempotencyModule,
        TransactionalOrmModule,
        CommonModule,
        TerminusModule,
        HealthModule,
        WebhookModule
    ],
    providers: [
        // Order matters: enrich spans, then record metrics
        { provide: APP_INTERCEPTOR, useClass: TracingEnrichmentInterceptor },
        { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
        { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor }, // KEEP
        { provide: APP_INTERCEPTOR, useClass: RpcLoggingInterceptor }
    ]
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(RequestIdMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
    }
}
