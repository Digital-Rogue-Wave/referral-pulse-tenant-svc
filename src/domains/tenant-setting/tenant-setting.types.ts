import type { JsonValue } from '@prisma-gen/generated/internal/prismaNamespace';

/**
 * Branding settings type
 */
export type BrandingSettings = {
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
};

/**
 * Notification settings type
 */
export type NotificationSettings = {
    emailEnabled?: boolean;
    webhookEnabled?: boolean;
};

/**
 * General settings type
 */
export type GeneralSettings = {
    timezone?: string;
    locale?: string;
};

/**
 * User notification preference overrides type
 */
export type NotificationOverrides = {
    emailEnabled?: boolean;
    smsEnabled?: boolean;
    pushEnabled?: boolean;
};

/**
 * Tenant Setting props from Prisma
 */
export type TenantSettingProps = {
    id: string;
    tenantId: string;
    branding: JsonValue;
    notifications: JsonValue;
    general: JsonValue;
    currencyCode: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};

/**
 * User Notification Preference props from Prisma
 */
export type UserNotificationPreferenceProps = {
    id: string;
    userId: string;
    tenantId: string;
    overrides: JsonValue;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};

/**
 * Tenant Setting event payloads
 */
export type TenantSettingCreatedPayload = {
    settingId: string;
    tenantId: string;
    currencyCode: string | null;
    createdAt: Date;
};

export type TenantSettingUpdatedPayload = {
    settingId: string;
    tenantId: string;
    changes: Record<string, { from: unknown; to: unknown }>;
    updatedAt: Date;
};

export type TenantSettingDeletedPayload = {
    settingId: string;
    tenantId: string;
    deletedAt: Date;
};

export type UserNotificationPreferenceUpdatedPayload = {
    preferenceId: string;
    userId: string;
    tenantId: string;
    overrides: NotificationOverrides;
    updatedAt: Date;
};
