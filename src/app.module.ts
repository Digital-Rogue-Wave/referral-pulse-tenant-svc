// NestJs built-in imports
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// typeorm related imports
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmConfigService } from './database/typeorm-config.service';
import { HealthModule } from '@mod/health/health.module';

// Centralized config imports
import { allConfigs } from '@mod/config';

// created validators-files imports
import { ClsModule } from 'nestjs-cls';
import { TerminusModule } from '@nestjs/terminus';
import { HttpMetricsInterceptor } from '@mod/common/monitoring/http-metrics.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TracingEnrichmentInterceptor } from '@mod/common/tracing/tracing.interceptor';
import { CommonModule } from '@mod/common/common.module';
import { TransactionalOrmModule } from '@mod/database/transactional-orm.module';
import { IdempotencyModule } from '@mod/common/idempotency/idempotency.module';
import { RequestIdMiddleware } from '@mod/common/middleware/request-id.middleware';
import { HttpLoggingInterceptor } from '@mod/common/logger/http-logging.interceptor';
import { RpcLoggingInterceptor } from '@mod/common/logger/rpc-logging.interceptor';
import { WebhookModule } from './webhook/webhook.module';
import { FilesModule } from './files/files.module';
import { TenantModule } from './tenant/tenant.module';
import { InvitationModule } from './invitation/invitation.module';
import { CurrencyModule } from './currency/currency.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { FeatureFlagModule } from './feature-flag/feature-flag.module';
import { AutomapperModule } from '@automapper/nestjs';
import { classes } from '@automapper/classes';
import { ApiKeyController } from './api-key/api-key.controller';
import { TenantMiddleware } from './common/tenant/tenant.middleware';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: allConfigs,
            envFilePath: ['.env']
        }),
        ClsModule.forRoot({ global: true, middleware: { mount: true, generateId: true } }),
        TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
        AutomapperModule.forRoot({
            strategyInitializer: classes()
        }),
        IdempotencyModule,
        TransactionalOrmModule,
        CommonModule,
        TerminusModule,
        HealthModule,
        WebhookModule,
        FilesModule,
        TenantModule,
        InvitationModule,
        CurrencyModule,
        ApiKeyModule,
        FeatureFlagModule
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
        consumer.apply(TenantMiddleware).forRoutes(ApiKeyController);
    }
}
