import { BaseResponseMapper } from '@common/helper/base-response.mapper';
import type {
    TenantSettingProps,
    UserNotificationPreferenceProps,
    BrandingSettings,
    NotificationSettings,
    GeneralSettings,
    NotificationOverrides,
} from '../tenant-setting.types';
import { TenantSettingResponse, UserNotificationPreferenceResponse } from '../responses/tenant-setting.responses';

/**
 * Mapper for TenantSetting entity to response
 */
class TenantSettingResponseMapper extends BaseResponseMapper<TenantSettingProps, TenantSettingResponse> {
    constructor() {
        super(TenantSettingResponse);
    }

    toResponse(entity: TenantSettingProps): TenantSettingResponse {
        const response = new TenantSettingResponse();
        response.id = entity.id;
        response.tenantId = entity.tenantId;
        response.branding = (entity.branding as BrandingSettings) || {};
        response.notifications = (entity.notifications as NotificationSettings) || {};
        response.general = (entity.general as GeneralSettings) || {};
        response.currencyCode = entity.currencyCode;
        response.createdAt = entity.createdAt;
        response.updatedAt = entity.updatedAt;
        return response;
    }
}

/**
 * Mapper for UserNotificationPreference entity to response
 */
class UserNotificationPreferenceResponseMapper extends BaseResponseMapper<
    UserNotificationPreferenceProps,
    UserNotificationPreferenceResponse
> {
    constructor() {
        super(UserNotificationPreferenceResponse);
    }

    toResponse(entity: UserNotificationPreferenceProps): UserNotificationPreferenceResponse {
        const response = new UserNotificationPreferenceResponse();
        response.id = entity.id;
        response.userId = entity.userId;
        response.tenantId = entity.tenantId;
        response.overrides = (entity.overrides as NotificationOverrides) || {};
        response.createdAt = entity.createdAt;
        response.updatedAt = entity.updatedAt;
        return response;
    }
}

export const tenantSettingResponseMapper = new TenantSettingResponseMapper();
export const userNotificationPreferenceResponseMapper = new UserNotificationPreferenceResponseMapper();
