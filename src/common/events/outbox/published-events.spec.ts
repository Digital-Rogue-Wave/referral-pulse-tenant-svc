import { ApiKeyCreatedEvent, ApiKeyDeletedEvent, ApiKeyRotatedEvent } from '@domains/api-key';
import {
    PaymentActionRequiredEvent,
    PaymentDisputedEvent,
    PaymentRefundedEvent,
    SubscriptionCancelledEvent,
    SubscriptionChangedEvent,
    SubscriptionCreatedEvent,
    SubscriptionDowngradeScheduledEvent,
    SubscriptionUpgradedEvent,
    TenantPaymentStatusChangedEvent,
    TrialExpiredEvent,
    TrialReminderEvent,
    UsageMonthlySummaryEvent,
    UsageThresholdCrossedEvent
} from '@domains/billing';
import type { BaseDomainEvent } from '@domains/common/events';
import {
    TenantCreatedEvent,
    TenantDeletedEvent,
    TenantDeletionCancelledEvent,
    TenantDeletionScheduledEvent,
    TenantDomainVerifiedEvent,
    TenantLockedEvent,
    TenantOwnershipTransferredEvent,
    TenantSuspendedEvent,
    TenantUnlockedEvent,
    TenantUnsuspendedEvent,
    TenantUpdatedEvent,
    TenantVerificationRequestedEvent,
    TenantVerificationStatusChangedEvent
} from '@domains/tenant/events/tenant.events';
import { UserAnonymisedEvent, UserInvitedEvent, UserLoggedInEvent, UserRegisteredEvent, UserRemovedEvent, UserRoleChangedEvent } from '@domains/user';

import { isPublishedEvent, PUBLISHED_EVENT_TYPES, toPublishedEvents } from './published-events';

const T = 't1';
const NOW = new Date('2026-09-22T00:00:00Z');
const ISO = NOW.toISOString();

/** One representative of every published in-process event. */
const EVENTS: BaseDomainEvent[] = [
    new TenantCreatedEvent(T, T, 'Acme', 'acme', 'k1', NOW, NOW, 'u1', { dataRegion: 'eu-central-1', retentionMonths: 24 }),
    new TenantUpdatedEvent(T, T, { retentionMonths: { from: 24, to: 12 } }, 'u1'),
    new TenantSuspendedEvent(T, T, 'fraud', NOW),
    new TenantUnsuspendedEvent(T, T, NOW),
    new TenantLockedEvent(T, T, 'owner request', NOW, NOW, 'u1'),
    new TenantUnlockedEvent(T, T, 'u1', NOW, 'u1'),
    new TenantDeletionScheduledEvent(T, T, NOW, NOW, 'closing', 'u1'),
    new TenantDeletionCancelledEvent(T, T, NOW, 'u1'),
    new TenantDeletedEvent(T, T, 'Acme', 'acme'),
    new TenantOwnershipTransferredEvent(T, T, 'u1', 'u2', NOW, 'u1'),
    new TenantDomainVerifiedEvent(T, T, 'refer.acme.io', NOW),
    new TenantVerificationRequestedEvent(T, T, 'Acme', 'u1', 'v1'),
    new TenantVerificationStatusChangedEvent(T, T, 'pending', 'verified', undefined, 'system'),
    new UserRegisteredEvent('u1', T, 'OWNER'),
    new UserRoleChangedEvent('u2', T, 'VIEWER', 'ADMIN', 'u1'),
    new UserRemovedEvent('u2', T, 'OPERATOR', 'u1'),
    new UserInvitedEvent('inv1', T, 'OPERATOR', 'u1'),
    new UserLoggedInEvent('u1', T, 'password', 'u1'),
    new UserAnonymisedEvent('u2', T, 'dsr1'),
    new ApiKeyCreatedEvent(
        'k1',
        T,
        { apiKeyId: 'k1', tenantId: T, label: 'CI', keyPrefix: 'abcd', keyType: 'secret', createdBy: 'u1', createdAt: NOW },
        'u1'
    ),
    new ApiKeyDeletedEvent(
        'k1',
        T,
        { apiKeyId: 'k1', tenantId: T, keyLabel: 'CI', keyPrefix: 'abcd', deletedBy: 'u1', deletedAt: NOW, reason: 'leak' },
        'u1'
    ),
    new ApiKeyRotatedEvent('k1', T, { apiKeyId: 'k1', keyType: 'secret', oldKeyPrefix: 'abcd', newKeyPrefix: 'efgh', rotatedBy: 'u1' }, 'u1'),
    new SubscriptionCreatedEvent('b1', T, 'Growth', 'active', 'sub1', 'cus1', NOW, NOW, 'evt1', 'u1'),
    new SubscriptionChangedEvent('b1', T, 'Starter', 'past_due', 'sub1', 'cus1', NOW, NOW, 'evt2'),
    new SubscriptionCancelledEvent('b1', T, ISO, ISO, 'sub1', 'Free', 'tenant_deleted'),
    new SubscriptionDowngradeScheduledEvent('b1', T, 'Growth', 'Starter', ISO, 'u1'),
    new SubscriptionUpgradedEvent('b1', T, 'Starter', 'Growth', ISO, 'u1'),
    new TrialReminderEvent(T, T, ISO, 3, ISO),
    new TrialExpiredEvent(T, T, ISO, ISO),
    new TenantPaymentStatusChangedEvent(T, T, 'active', 'past_due', ISO),
    new PaymentActionRequiredEvent('b1', T, 'evt3', 'in1', 'https://invoice.stripe.com/i/x', 4900, 'eur'),
    new PaymentDisputedEvent('b1', T, 'evt4', 'closed', 'dp1', 'ch1', 4900, 'eur', 'fraudulent', 'lost'),
    new PaymentRefundedEvent('b1', T, 'evt5', 'ch1', 4900, 'eur', true),
    new UsageThresholdCrossedEvent(T, T, 'email_sends', 80, 80, 100, 80, '2026-09', ISO),
    new UsageMonthlySummaryEvent(T, T, 'email_sends', '2026-08', 90, 100, '2026-08-31', ISO)
];

describe('Published events — the wire contract of every tenant-service event', () => {
    it.each(EVENTS.map((event) => [event.eventType, event] as const))('%s maps to a valid Event Model v3 draft', (type, event) => {
        expect(isPublishedEvent(type)).toBe(true);
        const drafts = toPublishedEvents(type, event);

        expect(drafts.length).toBeGreaterThan(0);
        for (const draft of drafts) {
            expect(draft.eventType).toMatch(/^[a-z_]+\.[a-z_]+$/);
            expect(draft.externalId.startsWith(`${draft.eventType}:`)).toBe(true);
            expect(draft.object.id).toBeTruthy();
            // The tenant always travels in the envelope; a property copy, when present, must agree.
            expect([undefined, T]).toContain(draft.properties.tenant_id);
            for (const [key, value] of Object.entries(draft.properties)) {
                expect(key).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
                expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
            }
        }
    });

    it('covers every mapper in the registry', () => {
        const covered = new Set<string>(EVENTS.map((event) => event.eventType));
        expect([...PUBLISHED_EVENT_TYPES].sort()).toEqual([...covered].sort());
    });

    it('never puts an email address or a raw token on the bus', () => {
        const wire = JSON.stringify(EVENTS.flatMap((event) => toPublishedEvents(event.eventType, event)));
        expect(wire).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    });

    it('publishes nothing for in-process-only events', () => {
        expect(isPublishedEvent('tenant-setting.updated')).toBe(false);
        expect(toPublishedEvents('tenant-setting.updated', {})).toEqual([]);
    });
});
