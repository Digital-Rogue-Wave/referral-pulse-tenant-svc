import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/billing.enum';

export interface SubscriptionChangedEvent {
    tenantId: string;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
}

export interface SubscriptionCreatedEvent {
    tenantId: string;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    checkoutUserId?: string | null;
}

export interface SubscriptionUpgradedEvent {
    tenantId: string;
    previousPlan: BillingPlanEnum;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    upgradeUserId?: string | null;
}

export interface SubscriptionDowngradeScheduledEvent {
    tenantId: string;
    previousPlan: BillingPlanEnum;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    downgradeUserId?: string | null;
    effectiveDate?: string | null;
}

export interface SubscriptionCancelledEvent {
    tenantId: string;
    previousPlan: BillingPlanEnum;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    cancelUserId?: string | null;
    cancellationReason?: string | null;
    cancellationEffectiveDate?: string | null;
}
