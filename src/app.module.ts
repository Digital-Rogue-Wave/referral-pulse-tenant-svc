import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';

import { configLoaders } from './config';

import { DatabaseModule } from '@app/database/database.module';
import { HealthModule } from '@app/health/health.module';

// Feature Modules
import { ApiKeyModule } from '@app/features/api-key/api-key.module';
import { BillingModule } from '@app/features/billing/billing.module';

import { DnsModule } from '@app/features/dns/dns.module';
import { FilesModule } from '@app/features/files/files.module';
import { InvitationModule } from '@app/features/invitation/invitation.module';
import { TeamMemberModule } from '@app/features/team-member/team-member.module';
import { TenantModule } from '@app/features/tenant/tenant.module';
import { TenantSettingModule } from '@app/features/tenant-setting/tenant-setting.module';
import { WebhookModule } from '@app/features/webhook/webhook.module';

import { AlsAuthInterceptor } from '@common/interceptor/als-auth.interceptor';
import { JwtAuthGuard } from '@common/auth/jwt-auth.guard';
import { CommonModule } from '@common/common.module';
import { GlobalExceptionsFilter } from '@common/exceptions/global-exceptions.filter';

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
        HealthModule,
        // Feature Modules
        ApiKeyModule,
        BillingModule,
        DnsModule,
        FilesModule,
        InvitationModule,
        TeamMemberModule,
        TenantModule,
        TenantSettingModule,
        WebhookModule,
    ],
    providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionsFilter },
        // { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: AlsAuthInterceptor },
    ],
})
export class AppModule {}
