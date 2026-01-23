import { Global, Module } from '@nestjs/common';
import { TenantModule } from './tenant/tenant.module';
import { AuthModule } from './auth/auth.module';
import { LoggingModule } from './logging/logging.module';
import { HttpModule } from './http/http.module';
import { ExceptionModule } from './exception/exception.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { MessagingModule } from './messaging/messaging.module';
import { TracingModule } from './monitoring/tracing.module';
import { HelperModule } from './helper/helper.module';

/**
 * CommonModule - Aggregates all common infrastructure modules
 * This module provides shared services, utilities, and infrastructure
 * used across the application.
 */
@Global()
@Module({
    imports: [
        TenantModule,
        AuthModule,
        LoggingModule,
        TracingModule,
        RedisModule,
        StorageModule,
        HttpModule,
        MessagingModule,
        ExceptionModule,
        HelperModule,
    ],
    exports: [
        TenantModule,
        AuthModule,
        LoggingModule,
        TracingModule,
        RedisModule,
        StorageModule,
        HttpModule,
        MessagingModule,
        ExceptionModule,
        HelperModule,
    ],
})
export class CommonModule {}
