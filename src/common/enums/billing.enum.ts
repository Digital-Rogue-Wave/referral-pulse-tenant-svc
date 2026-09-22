export enum BillingPlanEnum {
    FREE = 'Free',
    STARTER = 'Starter',
    GROWTH = 'Growth',
    ENTERPRISE = 'Enterprise'
}

/**
 * Subscription state, mirroring Stripe's subscription statuses (`incomplete_expired` is recorded as
 * `canceled`). `none` means the tenant never subscribed.
 */
export enum SubscriptionStatusEnum {
    NONE = 'none',
    TRIALING = 'trialing',
    ACTIVE = 'active',
    PAST_DUE = 'past_due',
    UNPAID = 'unpaid',
    INCOMPLETE = 'incomplete',
    PAUSED = 'paused',
    CANCELED = 'canceled'
}

/** A subscription the tenant still holds: its plan applies, and payment problems go through dunning. */
export const LIVE_SUBSCRIPTION_STATUSES: readonly string[] = [
    SubscriptionStatusEnum.TRIALING,
    SubscriptionStatusEnum.ACTIVE,
    SubscriptionStatusEnum.PAST_DUE,
    SubscriptionStatusEnum.UNPAID
];

export enum PaymentStatusEnum {
    ACTIVE = 'active',
    PAST_DUE = 'past_due',
    RESTRICTED = 'restricted',
    LOCKED = 'locked'
}
