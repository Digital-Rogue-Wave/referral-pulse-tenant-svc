import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/tenant.enum';

export interface SubscriptionChangedEvent {
    tenantId: string;
    billingPlan: BillingPlanEnum;
    subscriptionStatus: SubscriptionStatusEnum;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
}
