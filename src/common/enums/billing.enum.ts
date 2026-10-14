/**
 * Subscription tiers. DB Model v5 §3 names five: free, starter, growth, **scale**, enterprise.
 *
 * The values stay title-case. v5 puts `plan` on `tenants` with a lower-case CHECK, but this service
 * holds it on `billing.plan` — v5's DB Model defines no billing tables at all, so it had nowhere
 * else to put the column. Re-casing would be a data migration across `billing.plan`, `plans.name`
 * and the Stripe product metadata keyed to them: a live money path rewritten for a cosmetic
 * difference against a column that does not exist here. See NOTE.md decision T-3.
 */
export enum BillingPlanEnum {
    FREE = 'Free',
    STARTER = 'Starter',
    GROWTH = 'Growth',
    SCALE = 'Scale',
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
