import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';

import { configLoaders } from '@app/config';
import { CommonModule } from '@app/common/common.module';
import { GlobalExceptionFilter } from '@app/common/exception/global-exception.filter';
import { JwtAuthGuard } from '@app/common/auth/jwt-auth.guard';
import { ClsAuthInterceptor } from '@app/common/auth/cls-auth.interceptor';
import { DatabaseModule } from '@app/database/database.module';
import { HealthModule } from '@app/health/health.module';
import { MessagingModule } from '@app/common/messaging/messaging.module';
import { EventsModule } from '@app/common/events/events.module';
import { SideEffectsModule } from '@app/common/side-effects/side-effects.module';
import { TotoModule } from './toto-exemple/toto.module';

// Determine if running in worker mode
const isWorkerMode = process.env.APP_MODE?.toLowerCase() === 'worker';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: configLoaders,
            cache: true,
            expandVariables: true,
            envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
        }),
        TerminusModule,
        CommonModule,
        DatabaseModule,
        EventsModule, // Event-driven side effects
        MessagingModule.forRoot(),
        SideEffectsModule.forRoot({ enableWorker: isWorkerMode }),
        HealthModule,
        TotoModule,
    ],
    providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: ClsAuthInterceptor },
    ],
})
export class AppModule {}
