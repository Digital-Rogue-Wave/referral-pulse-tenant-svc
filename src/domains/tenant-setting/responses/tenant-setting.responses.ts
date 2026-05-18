import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
    BrandingSettings,
    NotificationSettings,
    GeneralSettings,
    NotificationOverrides,
} from '../tenant-setting.types';

/**
 * Tenant Setting Response class for API responses
 */
export class TenantSettingResponse {
    @ApiProperty({
        description: 'Unique identifier for the tenant setting',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    id!: string;

    @ApiProperty({
        description: 'Tenant ID this setting belongs to',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    tenantId!: string;

    @ApiProperty({
        description: 'Branding settings',
        example: {
            primaryColor: '#FF5733',
            secondaryColor: '#333333',
            fontFamily: 'Inter',
        },
    })
    branding!: BrandingSettings;

    @ApiProperty({
        description: 'Notification settings',
        example: { emailEnabled: true, webhookEnabled: false },
    })
    notifications!: NotificationSettings;

    @ApiProperty({
        description: 'General settings',
        example: { timezone: 'America/New_York', locale: 'en-US' },
    })
    general!: GeneralSettings;

    @ApiPropertyOptional({
        description: 'Currency code',
        example: 'USD',
    })
    currencyCode!: string | null;

    @ApiProperty({
        description: 'When the setting was created',
        example: '2024-12-11T10:30:00Z',
    })
    createdAt!: Date;

    @ApiProperty({
        description: 'When the setting was last updated',
        example: '2024-12-11T10:30:00Z',
    })
    updatedAt!: Date;
}

/**
 * User Notification Preference Response class
 */
export class UserNotificationPreferenceResponse {
    @ApiProperty({
        description: 'Unique identifier for the preference',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    id!: string;

    @ApiProperty({
        description: 'User ID',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    userId!: string;

    @ApiProperty({
        description: 'Tenant ID',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    tenantId!: string;

    @ApiProperty({
        description: 'Notification preference overrides',
        example: { emailEnabled: true, smsEnabled: false, pushEnabled: true },
    })
    overrides!: NotificationOverrides;

    @ApiProperty({
        description: 'When the preference was created',
        example: '2024-12-11T10:30:00Z',
    })
    createdAt!: Date;

    @ApiProperty({
        description: 'When the preference was last updated',
        example: '2024-12-11T10:30:00Z',
    })
    updatedAt!: Date;
}
