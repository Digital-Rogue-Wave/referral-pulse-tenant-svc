import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/billing.enum';

export interface SubscriptionChangedEvent {
    tenantId: string;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeEventId?: string;
}

export interface SubscriptionCreatedEvent {
    tenantId: string;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    checkoutUserId?: string | null;
    stripeEventId?: string;
}

export interface SubscriptionUpgradedEvent {
    tenantId: string;
    previousPlan: BillingPlanEnum;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    upgradeUserId?: string | null;
    stripeEventId?: string;
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
    stripeEventId?: string;
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
    stripeEventId?: string;
}

export interface TrialReminderEvent {
    tenantId: string;
    daysRemaining: number;
    trialEndsAt: string;
    triggeredAt: string;
}

export interface TrialExpiredEvent {
    tenantId: string;
    trialEndsAt: string;
    downgradedTo: BillingPlanEnum;
    triggeredAt: string;
}

export interface PaymentFailedEvent {
    tenantId: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeInvoiceId?: string;
}

export interface TenantPaymentStatusChangedEvent {
    tenantId: string;
    previousStatus: string;
    nextStatus: string;
    changedAt: string;
    source: 'stripe' | 'escalation';

    stripeEventId?: string;

    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeInvoiceId?: string;
    stripePaymentIntentId?: string;
    nextPaymentAttemptAt?: string | null;
}
