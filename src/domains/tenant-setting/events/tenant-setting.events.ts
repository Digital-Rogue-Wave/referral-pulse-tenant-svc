import { BaseDomainEvent } from '@domains/common/events/base-domain.event';
import type {
    TenantSettingCreatedPayload,
    TenantSettingUpdatedPayload,
    TenantSettingDeletedPayload,
    UserNotificationPreferenceUpdatedPayload,
} from '../tenant-setting.types';

/**
 * Event emitted when tenant settings are created
 */
export class TenantSettingCreatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('tenant-setting', 'created');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: TenantSettingCreatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when tenant settings are updated
 */
export class TenantSettingUpdatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('tenant-setting', 'updated');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: TenantSettingUpdatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when tenant settings are deleted
 */
export class TenantSettingDeletedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('tenant-setting', 'deleted');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: TenantSettingDeletedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when user notification preferences are updated
 */
export class UserNotificationPreferenceUpdatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('notification', 'updated');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: UserNotificationPreferenceUpdatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}
