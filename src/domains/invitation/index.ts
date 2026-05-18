import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Domain Events
// ============================================================

/**
 * Emitted when an invitation is created.
 * payload.email, payload.token, payload.tenantId, payload.role, payload.expiresAt
 * are used by EmailNotificationListener to send the invitation email.
 */
export class InvitationCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'invitation.created' as const;

    constructor(
        public readonly aggregateId: string, // invitationId
        public readonly tenantId: string,
        public readonly payload: {
            invitationId: string;
            tenantId: string;
            email: string;
            role: string;
            token: string;
            expiresAt: Date;
        },
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Emitted when an invitation is resent.
 * payload.email, payload.tenantId, payload.newExpiresAt, payload.resentAt
 * are used by EmailNotificationListener to send the resent invitation email.
 */
export class InvitationResentEvent extends BaseDomainEvent {
    readonly eventType = 'invitation.resent' as const;

    constructor(
        public readonly aggregateId: string, // invitationId
        public readonly tenantId: string,
        public readonly payload: {
            invitationId: string;
            tenantId: string;
            email: string;
            newExpiresAt: Date;
            resentAt: Date;
        },
        public readonly userId?: string,
    ) {
        super();
    }
}

export const InvitationEvents = {
    CREATED: 'invitation.created',
    RESENT: 'invitation.resent',
} as const;
