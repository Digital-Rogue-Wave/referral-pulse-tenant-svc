import type { ApiKeyEventType } from '@app/types';
import { BaseDomainEvent } from '@domains/common/events/base-domain.event';
import type {
    ApiKeyCreatedPayload,
    ApiKeyUpdatedPayload,
    ApiKeyStatusUpdatedPayload,
    ApiKeyDeletedPayload,
} from '../api-key.types';

export const ApiKeyEvents = {
    CREATED: 'api-key.created',
    UPDATED: 'api-key.updated',
    STATUS: 'api-key.status',
    DELETED: 'api-key.deleted',
} as const satisfies Record<string, ApiKeyEventType>;

/**
 * Event emitted when a new API key is created
 */
export class ApiKeyCreatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('api-key', 'created');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: ApiKeyCreatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when an API key is updated
 */
export class ApiKeyUpdatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('api-key', 'updated');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: ApiKeyUpdatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when an API key status is updated
 */
export class ApiKeyStatusUpdatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('api-key', 'status');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: ApiKeyStatusUpdatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when an API key is deleted
 */
export class ApiKeyDeletedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('api-key', 'deleted');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: ApiKeyDeletedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}
