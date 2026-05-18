import { BaseDomainEvent } from '@domains/common/events';

/**
 * Domain event emitted when a subscription changes
 */
export class SubscriptionChangedEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.changed' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly stripeSubscriptionId: string,
        public readonly stripeCustomerId: string,
        public readonly billingPlan: string,
        public readonly subscriptionStatus: string,
        public readonly currentPeriodStart: Date,
        public readonly currentPeriodEnd: Date,
        public readonly stripeEventId?: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a subscription is created
 */
export class SubscriptionCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly stripeSubscriptionId: string,
        public readonly stripeCustomerId: string,
        public readonly billingPlan: string,
        public readonly subscriptionStatus: string,
        public readonly currentPeriodStart: Date,
        public readonly currentPeriodEnd: Date,
        public readonly stripeEventId?: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a subscription is cancelled
 */
export class SubscriptionCancelledEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.cancelled' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly stripeSubscriptionId: string,
        public readonly cancelledAt: string,
        public readonly endsAt: string,
        public readonly reason?: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a subscription downgrade is scheduled
 */
export class SubscriptionDowngradeScheduledEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.downgrade-scheduled' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousPlan: string,
        public readonly targetPlan: string,
        public readonly effectiveDate: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a subscription is upgraded
 */
export class SubscriptionUpgradedEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.upgraded' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousPlan: string,
        public readonly newPlan: string,
        public readonly effectiveDate: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when tenant payment status changes
 */
export class TenantPaymentStatusChangedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.payment-status-changed' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly nextStatus: string,
        public readonly changedAt: string,
        public readonly reason?: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted as a trial reminder
 */
export class TrialReminderEvent extends BaseDomainEvent {
    readonly eventType = 'trial.reminder' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly trialEndsAt: string,
        public readonly daysRemaining: number,
        public readonly triggeredAt: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a trial expires
 */
export class TrialExpiredEvent extends BaseDomainEvent {
    readonly eventType = 'trial.expired' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly trialEndsAt: string,
        public readonly triggeredAt: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a payment fails
 */
export class PaymentFailedEvent extends BaseDomainEvent {
    readonly eventType = 'payment.failed' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly nextStatus: string,
        public readonly changedAt: string,
        public readonly reason?: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a payment is restored
 */
export class PaymentRestoredEvent extends BaseDomainEvent {
    readonly eventType = 'payment.restored' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly nextStatus: string,
        public readonly changedAt: string,
        public readonly reason?: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a tenant is restricted due to billing
 */
export class TenantRestrictedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.restricted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly nextStatus: string,
        public readonly changedAt: string,
        public readonly reason?: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a tenant is restored from billing restriction
 */
export class TenantRestoredEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.restored' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly nextStatus: string,
        public readonly changedAt: string,
        public readonly reason?: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event type constants for convenience
 */
export const BillingEvents = {
    SUBSCRIPTION_CHANGED: 'subscription.changed',
    SUBSCRIPTION_CREATED: 'subscription.created',
    SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
    SUBSCRIPTION_DOWNGRADE_SCHEDULED: 'subscription.downgrade-scheduled',
    SUBSCRIPTION_UPGRADED: 'subscription.upgraded',
    TENANT_PAYMENT_STATUS_CHANGED: 'tenant.payment-status-changed',
    TRIAL_REMINDER: 'trial.reminder',
    TRIAL_EXPIRED: 'trial.expired',
    USAGE_THRESHOLD_CROSSED: 'usage.threshold_crossed',
    USAGE_MONTHLY_SUMMARY: 'usage.monthly_summary',
    PAYMENT_FAILED: 'payment.failed',
    PAYMENT_RESTORED: 'payment.restored',
    TENANT_RESTRICTED: 'tenant.restricted',
    TENANT_LOCKED: 'tenant.locked',
    TENANT_RESTORED: 'tenant.restored',
} as const;
