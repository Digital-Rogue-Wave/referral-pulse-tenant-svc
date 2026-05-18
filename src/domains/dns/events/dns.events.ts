import { BaseDomainEvent } from '@domains/common/events/base-domain.event';
import type {
    SubdomainReservedPayload,
    SubdomainReleasedPayload,
    CustomDomainAddedPayload,
    CustomDomainVerifiedPayload,
    CustomDomainRemovedPayload,
} from '../dns.types';

/**
 * Emitted when a subdomain is reserved for a tenant
 */
export class SubdomainReservedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('dns', 'reserved');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: SubdomainReservedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Emitted when a subdomain reservation is released
 */
export class SubdomainReleasedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('dns', 'released');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: SubdomainReleasedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Emitted when a custom domain is added to a tenant
 */
export class CustomDomainAddedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('dns', 'domain-added');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: CustomDomainAddedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Emitted when a custom domain is verified
 */
export class CustomDomainVerifiedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('dns', 'domain-verified');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: CustomDomainVerifiedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Emitted when a custom domain is removed
 */
export class CustomDomainRemovedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('dns', 'domain-removed');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: CustomDomainRemovedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}