import type { BaseDomainEvent } from '@domains/common/events';
import type { ApiKeyCreatedEvent, ApiKeyDeletedEvent, ApiKeyRotatedEvent } from '@domains/api-key';
import type {
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
import type {
    TenantCreatedEvent,
    TenantDeletedEvent,
    TenantDeletionScheduledEvent,
    TenantDomainVerifiedEvent,
    TenantLockedEvent,
    TenantOwnershipTransferredEvent,
    TenantSuspendedEvent,
    TenantUnlockedEvent,
    TenantUpdatedEvent,
    TenantVerificationRequestedEvent,
    TenantVerificationStatusChangedEvent
} from '@domains/tenant/events/tenant.events';
import type {
    UserAnonymisedEvent,
    UserInvitedEvent,
    UserLoggedInEvent,
    UserRegisteredEvent,
    UserRemovedEvent,
    UserRoleChangedEvent
} from '@domains/user';

/** Event Model v3 §2.3 `object.object_type`, extended with tenant-service's aggregates (additive enum values). */
export type PublishedObjectType = 'tenant' | 'user' | 'api_key' | 'subscription' | 'invitation';

/** Flat properties (Event Model v3 §2.5): primitive values only, snake_case keys. */
export type FlatProperties = Record<string, string | number | boolean | null>;

/** What a domain event becomes on the bus; the envelope builder adds everything else. */
export interface PublishedEventDraft {
    eventType: string;
    /** Deterministic per domain fact (Event Model v3 §2.1) — a replay of the same fact produces the same key. */
    externalId: string;
    object: { type: PublishedObjectType; id: string };
    properties: FlatProperties;
    schemaVersion?: number;
}

type Mapper<E> = (event: E) => PublishedEventDraft[];

const iso = (value: Date | string | undefined | null): string | null => (value ? new Date(value).toISOString() : null);
const tenantObject = (event: BaseDomainEvent) => ({ type: 'tenant' as const, id: event.tenantId });

/**
 * The public events tenant-service publishes, keyed by the in-process event name. Anything not listed here
 * stays in-process. Public names use snake_case actions; identity events follow Event Model v2.1 §4.12
 * (`user.registered`, `user.logged_in`, `api_key.created`, `api_key.revoked`) and the rest are this
 * service's documented extensions (NOTE.md "Events").
 */
const MAPPERS: Record<string, Mapper<never>> = {
    // ── Tenant lifecycle ──
    'tenant.created': (e: TenantCreatedEvent) => [
        {
            eventType: 'tenant.created',
            externalId: `tenant.created:${e.tenantId}`,
            object: tenantObject(e),
            properties: {
                tenant_id: e.tenantId,
                name: e.name,
                slug: e.slug,
                trial_started_at: iso(e.trialStartedAt),
                trial_ends_at: iso(e.trialEndsAt),
                data_region: e.residency?.dataRegion ?? null,
                retention_months: e.residency?.retentionMonths ?? null
            }
        }
    ],
    'tenant.updated': (e: TenantUpdatedEvent) => [
        {
            eventType: 'tenant.updated',
            externalId: `tenant.updated:${e.eventId}`,
            object: tenantObject(e),
            properties: {
                tenant_id: e.tenantId,
                changed_fields: Object.keys(e.changes).sort().join(','),
                // Services applying the tenant's retention window need the new value, not only the field name.
                ...(e.changes.retentionMonths ? { retention_months: Number(e.changes.retentionMonths.to) } : {})
            }
        }
    ],
    'tenant.suspended': (e: TenantSuspendedEvent) => [
        {
            eventType: 'tenant.suspended',
            externalId: `tenant.suspended:${e.tenantId}:${e.suspendedAt.toISOString()}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, reason: e.reason, suspended_at: iso(e.suspendedAt) }
        }
    ],
    'tenant.unsuspended': (e: BaseDomainEvent) => [
        {
            eventType: 'tenant.unsuspended',
            externalId: `tenant.unsuspended:${e.eventId}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId }
        }
    ],
    'tenant.locked': (e: TenantLockedEvent) => [
        {
            eventType: 'tenant.locked',
            externalId: `tenant.locked:${e.tenantId}:${e.lockedAt.toISOString()}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, locked_at: iso(e.lockedAt), lock_until: iso(e.lockUntil) }
        }
    ],
    'tenant.unlocked': (e: TenantUnlockedEvent) => [
        {
            eventType: 'tenant.unlocked',
            externalId: `tenant.unlocked:${e.tenantId}:${e.unlockedAt.toISOString()}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, unlocked_at: iso(e.unlockedAt) }
        }
    ],
    'tenant.deletion-scheduled': (e: TenantDeletionScheduledEvent) => [
        {
            eventType: 'tenant.deletion_scheduled',
            externalId: `tenant.deletion_scheduled:${e.eventId}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, scheduled_at: iso(e.scheduledAt), execution_date: iso(e.executionDate) }
        }
    ],
    'tenant.deletion-cancelled': (e: BaseDomainEvent) => [
        {
            eventType: 'tenant.deletion_cancelled',
            externalId: `tenant.deletion_cancelled:${e.eventId}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId }
        }
    ],
    'tenant.deleted': (e: TenantDeletedEvent) => [
        { eventType: 'tenant.deleted', externalId: `tenant.deleted:${e.tenantId}`, object: tenantObject(e), properties: { tenant_id: e.tenantId } }
    ],
    'tenant.ownership-transferred': (e: TenantOwnershipTransferredEvent) => [
        {
            eventType: 'tenant.ownership_transferred',
            externalId: `tenant.ownership_transferred:${e.eventId}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, previous_owner_id: e.oldOwnerId, new_owner_id: e.newOwnerId, transferred_at: iso(e.transferredAt) }
        }
    ],
    'tenant.domain-verified': (e: TenantDomainVerifiedEvent) => [
        {
            eventType: 'tenant.domain_verified',
            externalId: `tenant.domain_verified:${e.tenantId}:${e.domain}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, domain: e.domain, verified_at: iso(e.verifiedAt) }
        }
    ],
    'tenant.verification_requested': (e: TenantVerificationRequestedEvent) => [
        {
            eventType: 'tenant.verification_requested',
            externalId: `tenant.verification_requested:${e.verificationId ?? e.eventId}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, verification_id: e.verificationId ?? null, verification_type: 'company' }
        }
    ],
    'tenant.verification_status_changed': (e: TenantVerificationStatusChangedEvent) => [
        {
            eventType: 'tenant.verification_status_changed',
            externalId: `tenant.verification_status_changed:${e.eventId}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, previous_status: e.previousStatus, new_status: e.newStatus, reason: e.reason ?? null }
        }
    ],

    // ── Operators (Event Model v2.1 §4.12) ──
    'user.registered': (e: UserRegisteredEvent) => [
        {
            eventType: 'user.registered',
            externalId: `user.registered:${e.aggregateId}`,
            object: { type: 'user', id: e.aggregateId },
            properties: { user_id: e.aggregateId, tenant_id: e.tenantId, role: e.role.toLowerCase() }
        }
    ],
    'user.role_changed': (e: UserRoleChangedEvent) => [
        {
            eventType: 'user.role_changed',
            externalId: `user.role_changed:${e.eventId}`,
            object: { type: 'user', id: e.aggregateId },
            properties: { user_id: e.aggregateId, tenant_id: e.tenantId, previous_role: e.oldRole.toLowerCase(), new_role: e.newRole.toLowerCase() }
        }
    ],
    'user.removed': (e: UserRemovedEvent) => [
        {
            eventType: 'user.removed',
            externalId: `user.removed:${e.eventId}`,
            object: { type: 'user', id: e.aggregateId },
            properties: { user_id: e.aggregateId, tenant_id: e.tenantId, role: e.role.toLowerCase() }
        }
    ],
    'user.anonymised': (e: UserAnonymisedEvent) => [
        {
            eventType: 'user.anonymised',
            externalId: `user.anonymised:${e.aggregateId}`,
            object: { type: 'user', id: e.aggregateId },
            properties: { user_id: e.aggregateId, tenant_id: e.tenantId, dsr_id: e.dsrId }
        }
    ],
    'user.invited': (e: UserInvitedEvent) => [
        {
            eventType: 'user.invited',
            externalId: `user.invited:${e.aggregateId}`,
            object: { type: 'invitation', id: e.aggregateId },
            properties: { invitation_id: e.aggregateId, tenant_id: e.tenantId, role: e.role.toLowerCase() }
        }
    ],
    'user.logged_in': (e: UserLoggedInEvent) => [
        {
            eventType: 'user.logged_in',
            externalId: `user.logged_in:${e.eventId}`,
            object: { type: 'user', id: e.aggregateId },
            properties: { user_id: e.aggregateId, auth_method: e.authMethod }
        }
    ],

    // ── API keys (Event Model v2.1 §4.12) ──
    'api-key.created': (e: ApiKeyCreatedEvent) => [
        {
            eventType: 'api_key.created',
            externalId: `api_key.created:${e.payload.apiKeyId}`,
            object: { type: 'api_key', id: e.payload.apiKeyId },
            properties: { key_id: e.payload.apiKeyId, key_type: e.payload.keyType, tenant_id: e.tenantId, created_by: e.payload.createdBy }
        }
    ],
    'api-key.deleted': (e: ApiKeyDeletedEvent) => [
        {
            eventType: 'api_key.revoked',
            externalId: `api_key.revoked:${e.payload.apiKeyId}`,
            object: { type: 'api_key', id: e.payload.apiKeyId },
            properties: { key_id: e.payload.apiKeyId, revoked_by: e.payload.deletedBy, revocation_reason: e.payload.reason }
        }
    ],
    'api-key.rotated': (e: ApiKeyRotatedEvent) => [
        {
            eventType: 'api_key.rotated',
            externalId: `api_key.rotated:${e.payload.apiKeyId}:${e.payload.newKeyPrefix}`,
            object: { type: 'api_key', id: e.payload.apiKeyId },
            properties: { key_id: e.payload.apiKeyId, key_type: e.payload.keyType, tenant_id: e.tenantId, rotated_by: e.payload.rotatedBy }
        }
    ],

    // ── Billing (this service's extension) ──
    'subscription.created': (e: SubscriptionCreatedEvent) => [subscriptionDraft('subscription.created', e)],
    'subscription.changed': (e: SubscriptionChangedEvent) => [subscriptionDraft('subscription.changed', e)],
    'subscription.cancelled': (e: SubscriptionCancelledEvent) => [
        {
            eventType: 'subscription.cancelled',
            externalId: `subscription.cancelled:${e.stripeSubscriptionId ?? e.eventId}`,
            object: { type: 'subscription', id: e.stripeSubscriptionId ?? e.tenantId },
            properties: { tenant_id: e.tenantId, cancelled_at: iso(e.cancelledAt), ends_at: iso(e.cancellationEffectiveAt), reason: e.reason ?? null }
        }
    ],
    'subscription.downgrade-scheduled': (e: SubscriptionDowngradeScheduledEvent) => [
        {
            eventType: 'subscription.downgrade_scheduled',
            externalId: `subscription.downgrade_scheduled:${e.eventId}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, previous_plan: e.previousPlan, target_plan: e.targetPlan, effective_date: iso(e.effectiveDate) }
        }
    ],
    'subscription.upgraded': (e: SubscriptionUpgradedEvent) => [
        {
            eventType: 'subscription.upgraded',
            externalId: `subscription.upgraded:${e.eventId}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, previous_plan: e.previousPlan, new_plan: e.billingPlan, effective_date: iso(e.effectiveDate) }
        }
    ],
    'trial.reminder': (e: TrialReminderEvent) => [
        {
            eventType: 'trial.reminder',
            externalId: `trial.reminder:${e.tenantId}:${e.daysRemaining}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, trial_ends_at: iso(e.trialEndsAt), days_remaining: e.daysRemaining }
        }
    ],
    'trial.expired': (e: TrialExpiredEvent) => [
        {
            eventType: 'trial.expired',
            externalId: `trial.expired:${e.tenantId}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, trial_ends_at: iso(e.trialEndsAt) }
        }
    ],
    'tenant.payment-status-changed': (e: TenantPaymentStatusChangedEvent) => paymentStatusDrafts(e),
    'usage.threshold_crossed': (e: UsageThresholdCrossedEvent) => [
        {
            eventType: 'usage.threshold_crossed',
            externalId: `usage.threshold_crossed:${e.tenantId}:${e.metric}:${e.threshold}:${e.periodDate}`,
            object: tenantObject(e),
            properties: {
                tenant_id: e.tenantId,
                metric: e.metric,
                threshold: e.threshold,
                usage: e.usage,
                limit: e.limit,
                percentage: e.percentage,
                period_date: String(e.periodDate)
            }
        }
    ],
    'usage.monthly_summary': (e: UsageMonthlySummaryEvent) => [
        {
            eventType: 'usage.monthly_summary',
            externalId: `usage.monthly_summary:${e.tenantId}:${e.metric}:${e.month}`,
            object: tenantObject(e),
            properties: { tenant_id: e.tenantId, metric: e.metric, month: e.month, usage: e.usage, limit: e.limit }
        }
    ]
};

function subscriptionDraft(eventType: string, e: SubscriptionCreatedEvent | SubscriptionChangedEvent): PublishedEventDraft {
    return {
        eventType,
        externalId: `${eventType}:${e.stripeEventId ?? e.eventId}`,
        object: { type: 'subscription', id: e.stripeSubscriptionId ?? e.tenantId },
        properties: {
            tenant_id: e.tenantId,
            plan: e.billingPlan,
            status: e.subscriptionStatus,
            current_period_start: iso(e.currentPeriodStart),
            current_period_end: iso(e.currentPeriodEnd)
        }
    };
}

/**
 * One payment-status change becomes the generic `tenant.payment_status_changed` plus the specific signal
 * consumers act on. Access tiers for non-payment are named `tenant.payment_*` so they can never be confused
 * with a tenant's self-lock (`tenant.locked`).
 */
function paymentStatusDrafts(e: TenantPaymentStatusChangedEvent): PublishedEventDraft[] {
    const properties: FlatProperties = {
        tenant_id: e.tenantId,
        previous_status: e.previousStatus,
        new_status: e.nextStatus,
        changed_at: iso(e.changedAt),
        reason: e.reason ?? null
    };
    const draft = (eventType: string): PublishedEventDraft => ({
        eventType,
        externalId: `${eventType}:${e.eventId}`,
        object: tenantObject(e),
        properties
    });
    const specific: Record<string, string[]> = {
        past_due: ['payment.failed'],
        restricted: ['tenant.payment_restricted'],
        locked: ['tenant.payment_locked'],
        active: e.previousStatus === 'active' ? [] : ['payment.restored', 'tenant.payment_restored']
    };
    return [draft('tenant.payment_status_changed'), ...(specific[e.nextStatus] ?? []).map(draft)];
}

/** Public drafts for an in-process event, or an empty list when it stays in-process. */
export function toPublishedEvents(eventName: string, event: unknown): PublishedEventDraft[] {
    const mapper = MAPPERS[eventName] as Mapper<unknown> | undefined;
    return mapper ? mapper(event) : [];
}

export const isPublishedEvent = (eventName: string): boolean => eventName in MAPPERS;
