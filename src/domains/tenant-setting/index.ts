import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Shared types
// ============================================================

export interface NotificationOverrides {
    emailEnabled?: boolean;
    smsEnabled?: boolean;
    pushEnabled?: boolean;
}

// ============================================================
// Props (shape of the Prisma models)
// ============================================================

export interface TenantSettingProps {
    id: string;
    tenantId: string;
    branding: unknown;
    notifications: unknown;
    general: unknown;
    currencyCode?: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
}

export interface UserNotificationPreferenceProps {
    id: string;
    userId: string;
    tenantId: string;
    overrides: unknown;
    createdAt: Date;
    updatedAt: Date;
}

// ============================================================
// DTOs — TenantSetting
// ============================================================

export class CreateTenantSettingDto {
    @ApiPropertyOptional()
    @IsOptional()
    branding?: Record<string, unknown>;

    @ApiPropertyOptional()
    @IsOptional()
    notifications?: Record<string, unknown>;

    @ApiPropertyOptional()
    @IsOptional()
    general?: Record<string, unknown>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    currencyCode?: string;
}

export class UpdateTenantSettingDto {
    @ApiPropertyOptional()
    @IsOptional()
    branding?: Record<string, unknown>;

    @ApiPropertyOptional()
    @IsOptional()
    notifications?: Record<string, unknown>;

    @ApiPropertyOptional()
    @IsOptional()
    general?: Record<string, unknown>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    currencyCode?: string;
}

// ============================================================
// DTOs — UserNotificationPreference
// ============================================================

export class UpdateUserNotificationPreferenceDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    emailEnabled?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    smsEnabled?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    pushEnabled?: boolean;
}

// ============================================================
// Responses
// ============================================================

export class TenantSettingResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty()
    branding!: unknown;

    @ApiProperty()
    notifications!: unknown;

    @ApiProperty()
    general!: unknown;

    @ApiPropertyOptional()
    currencyCode?: string | null;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty()
    updatedAt!: Date;

    @ApiPropertyOptional()
    deletedAt?: Date | null;
}

export class UserNotificationPreferenceResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    userId!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty()
    overrides!: unknown;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty()
    updatedAt!: Date;
}

// ============================================================
// Mappers
// ============================================================

class TenantSettingResponseMapper extends BaseResponseMapper<TenantSettingProps, TenantSettingResponse> {
    constructor() {
        super(TenantSettingResponse);
    }
}

export const tenantSettingResponseMapper = new TenantSettingResponseMapper();

class UserNotificationPreferenceResponseMapper extends BaseResponseMapper<
    UserNotificationPreferenceProps,
    UserNotificationPreferenceResponse
> {
    constructor() {
        super(UserNotificationPreferenceResponse);
    }
}

export const userNotificationPreferenceResponseMapper = new UserNotificationPreferenceResponseMapper();

// ============================================================
// Domain Events — TenantSetting
// ============================================================

export class TenantSettingCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant-setting.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            settingId: string;
            tenantId: string;
            currencyCode?: string | null;
            createdAt: Date;
        },
        public readonly userId?: string,
    ) {
        super();
    }
}

export class TenantSettingUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant-setting.updated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            settingId: string;
            tenantId: string;
            changes: Record<string, { from: unknown; to: unknown }>;
            updatedAt: Date;
        },
        public readonly userId?: string,
    ) {
        super();
    }
}

export class TenantSettingDeletedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant-setting.deleted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            settingId: string;
            tenantId: string;
            deletedAt: Date;
        },
        public readonly userId?: string,
    ) {
        super();
    }
}

// ============================================================
// Domain Events — UserNotificationPreference
// ============================================================

export class UserNotificationPreferenceUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'notification.updated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            preferenceId: string;
            userId: string;
            tenantId: string;
            overrides: NotificationOverrides;
            updatedAt: Date;
        },
        public readonly userId?: string,
    ) {
        super();
    }
}

export const TenantSettingEvents = {
    CREATED: 'tenant-setting.created',
    UPDATED: 'tenant-setting.updated',
    DELETED: 'tenant-setting.deleted',
    NOTIFICATION_UPDATED: 'notification.updated',
} as const;
