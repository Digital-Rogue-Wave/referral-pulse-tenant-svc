import type { BaseEventType } from '@app/types';

import { BaseDomainEvent } from './base-domain.event';

/**
 * Email event for all email notifications
 *
 * Critical vs non-critical is determined by the `critical` option
 * when creating the side effect, not by a separate event type.
 *
 * Usage:
 *   this.txEventEmitter.emitAfterCommit(
 *     'email.sent',
 *     new EmailEvent(userId, tenantId, email, subject, body, { templateId, unsubscribeLink })
 *   );
 */
export class EmailEvent extends BaseDomainEvent {
    readonly eventType: BaseEventType = BaseDomainEvent.buildEventType('email', 'sent');

    constructor(
        public readonly aggregateId: string, // userId or entityId
        public readonly tenantId: string,
        public readonly to: string,
        public readonly subject: string,
        public readonly body: string,
        public readonly options?: {
            templateId?: string;
            unsubscribeLink?: string;
            metadata?: Record<string, unknown>;
        }
    ) {
        super();
    }

    get templateId(): string | undefined {
        return this.options?.templateId;
    }

    get unsubscribeLink(): string | undefined {
        return this.options?.unsubscribeLink;
    }

    get metadata(): Record<string, unknown> | undefined {
        return this.options?.metadata;
    }
}

/**
 * @deprecated Use EmailEvent instead. Critical vs non-critical is handled via SideEffectService options.
 */
export class CriticalEmailEvent extends EmailEvent {}

/**
 * @deprecated Use EmailEvent instead. Critical vs non-critical is handled via SideEffectService options.
 */
export class MarketingEmailEvent extends EmailEvent {}
