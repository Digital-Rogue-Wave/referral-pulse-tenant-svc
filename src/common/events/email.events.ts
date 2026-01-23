import { BaseDomainEvent } from './base-domain.event';

/**
 * Critical email event (password resets, receipts, verifications)
 * Sent via SQS to email service queue with DLQ monitoring
 *
 * Usage:
 *   this.txEventEmitter.emitAfterCommit(
 *     'email.critical.password-reset',
 *     new CriticalEmailEvent(userId, tenantId, email, subject, body, templateId)
 *   );
 */
export class CriticalEmailEvent extends BaseDomainEvent {
    readonly eventType: string;

    constructor(
        public readonly aggregateId: string, // userId or entityId
        public readonly tenantId: string,
        public readonly to: string,
        public readonly subject: string,
        public readonly body: string,
        public readonly templateId?: string,
        public readonly metadata?: Record<string, any>,
        eventType = 'email.critical.generic',
    ) {
        super();
        this.eventType = eventType;
    }
}

/**
 * Non-critical marketing email event (newsletters, promotions, updates)
 * Fire-and-forget HTTP call to email service
 *
 * Usage:
 *   this.txEventEmitter.emitAfterCommit(
 *     'email.marketing.newsletter',
 *     new MarketingEmailEvent(userId, tenantId, email, subject, body, unsubscribeLink)
 *   );
 */
export class MarketingEmailEvent extends BaseDomainEvent {
    readonly eventType: string;

    constructor(
        public readonly aggregateId: string, // userId
        public readonly tenantId: string,
        public readonly to: string,
        public readonly subject: string,
        public readonly body: string,
        public readonly unsubscribeLink?: string,
        public readonly metadata?: Record<string, any>,
        eventType = 'email.marketing.generic',
    ) {
        super();
        this.eventType = eventType;
    }
}