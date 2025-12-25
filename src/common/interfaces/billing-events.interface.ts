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
