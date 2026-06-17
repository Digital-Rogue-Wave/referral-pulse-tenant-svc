import { Global, Module } from '@nestjs/common';

import { ExceptionsModule } from '@common/exceptions/exceptions.module';

import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { CurrencyModule } from './currency/currency.module';
import { EventsModule } from './events';
import { HelperModule } from './helper/helper.module';
import { HttpModule } from './http/http.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LoggingModule } from './logging/logging.module';
import { MessagingModule } from './messaging/messaging.module';
import { TracingModule } from './monitoring/tracing.module';
import { RedisModule } from './redis/redis.module';
import { ResilienceModule } from './resilience/resilience.module';
import { RulesEngineModule } from './rules-engines/rules-engine.module';
import { SideEffectsModule } from './side-effects/side-effects.module';
import { StorageModule } from './storage/storage.module';
import { TenantAwareModule } from './tenant-aware/tenant-aware.module';

/**
 * CommonModule - Aggregates all common infrastructure modules
 * This module provides shared services, utilities, and infrastructure
 * used across the application.
 */
@Global()
@Module({
    imports: [
        TenantAwareModule,
        AuthModule,
        LoggingModule,
        TracingModule,
        RedisModule,
        StorageModule,
        ResilienceModule,
        HttpModule,
        MessagingModule.forRoot(),
        ExceptionsModule,
        HelperModule,
        SideEffectsModule.forRoot({ enableWorker: false }),
        RulesEngineModule,
        CurrencyModule,
        ClientsModule,
        IdempotencyModule,
        EventsModule
    ],
    providers: [],
    exports: [
        TenantAwareModule,
        AuthModule,
        LoggingModule,
        TracingModule,
        RedisModule,
        StorageModule,
        ResilienceModule,
        HttpModule,
        MessagingModule,
        ExceptionsModule,
        HelperModule,
        SideEffectsModule,
        RulesEngineModule,
        CurrencyModule,
        ClientsModule,
        IdempotencyModule,
        EventsModule
    ]
})
export class CommonModule {}
