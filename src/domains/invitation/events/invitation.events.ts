import { BaseDomainEvent } from '@domains/common/events/base-domain.event';
import type {
    InvitationCreatedPayload,
    InvitationAcceptedPayload,
    InvitationRevokedPayload,
    InvitationRejectedPayload,
    InvitationResentPayload,
} from '../invitation.types';

/**
 * Event emitted when an invitation is created
 */
export class InvitationCreatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('invitation', 'created');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: InvitationCreatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when an invitation is accepted
 */
export class InvitationAcceptedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('invitation', 'accepted');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: InvitationAcceptedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when an invitation is revoked
 */
export class InvitationRevokedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('invitation', 'revoked');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: InvitationRevokedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when an invitation is rejected
 */
export class InvitationRejectedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('invitation', 'rejected');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: InvitationRejectedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when an invitation is resent
 */
export class InvitationResentEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('invitation', 'resent');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: InvitationResentPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}
