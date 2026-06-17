import { BaseDomainEvent } from '@domains/common/events';

export class SubscriptionChangedEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.changed' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly billingPlan: string,
        public readonly subscriptionStatus: string,
        public readonly stripeSubscriptionId?: string,
        public readonly stripeCustomerId?: string,
        public readonly currentPeriodStart?: Date,
        public readonly currentPeriodEnd?: Date,
        public readonly stripeEventId?: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class SubscriptionCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly billingPlan: string,
        public readonly subscriptionStatus: string,
        public readonly stripeSubscriptionId?: string,
        public readonly stripeCustomerId?: string,
        public readonly currentPeriodStart?: Date,
        public readonly currentPeriodEnd?: Date,
        public readonly stripeEventId?: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class SubscriptionCancelledEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.cancelled' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly cancelledAt: string,
        public readonly cancellationEffectiveAt: string,
        public readonly stripeSubscriptionId?: string,
        public readonly billingPlan?: string,
        public readonly reason?: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class SubscriptionDowngradeScheduledEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.downgrade-scheduled' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousPlan: string,
        public readonly targetPlan: string,
        public readonly effectiveDate: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class SubscriptionUpgradedEvent extends BaseDomainEvent {
    readonly eventType = 'subscription.upgraded' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousPlan: string,
        public readonly billingPlan: string,
        public readonly effectiveDate: string,
        public readonly userId?: string
    ) {
        super();
    }
}

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
        public readonly stripeCustomerId?: string,
        public readonly stripeSubscriptionId?: string,
        public readonly stripeInvoiceId?: string,
        public readonly stripePaymentIntentId?: string,
        public readonly nextPaymentAttemptAt?: string | null
    ) {
        super();
    }
}

export class TrialReminderEvent extends BaseDomainEvent {
    readonly eventType = 'trial.reminder' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly trialEndsAt: string,
        public readonly daysRemaining: number,
        public readonly triggeredAt: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TrialExpiredEvent extends BaseDomainEvent {
    readonly eventType = 'trial.expired' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly trialEndsAt: string,
        public readonly triggeredAt: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class PaymentFailedEvent extends BaseDomainEvent {
    readonly eventType = 'payment.failed' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly nextStatus: string,
        public readonly changedAt: string,
        public readonly reason?: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class PaymentRestoredEvent extends BaseDomainEvent {
    readonly eventType = 'payment.restored' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly nextStatus: string,
        public readonly changedAt: string,
        public readonly reason?: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantRestrictedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.restricted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly nextStatus: string,
        public readonly changedAt: string,
        public readonly reason?: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantRestoredEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.restored' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly nextStatus: string,
        public readonly changedAt: string,
        public readonly reason?: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class UsageMonthlySummaryEvent extends BaseDomainEvent {
    readonly eventType = 'usage.monthly_summary' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly metric: string,
        public readonly month: string,
        public readonly usage: number,
        public readonly limit: number | null,
        public readonly periodDate: string,
        public readonly triggeredAt: string
    ) {
        super();
    }
}

export class UsageThresholdCrossedEvent extends BaseDomainEvent {
    readonly eventType = 'usage.threshold_crossed' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly metric: string,
        public readonly threshold: number,
        public readonly usage: number,
        public readonly limit: number,
        public readonly percentage: number,
        public readonly periodDate: string,
        public readonly triggeredAt: string
    ) {
        super();
    }
}

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
    TENANT_RESTORED: 'tenant.restored'
} as const;
