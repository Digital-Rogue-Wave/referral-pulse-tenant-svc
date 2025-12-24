import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/billing.enum';

export interface SubscriptionChangedEvent {
    tenantId: string;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
}
