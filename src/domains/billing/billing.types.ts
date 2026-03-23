import type { PlanLimits } from '@app/features/billing/plan-limits.type';

export type { PlanLimits };
export { assertValidPlanLimits } from '@app/features/billing/plan-limits.type';

export type PlanProps = {
    id: string;
    name: string;
    stripePriceId: string | null;
    stripeProductId: string | null;
    interval: string | null;
    limits: PlanLimits | null;
    tenantId: string | null;
    isActive: boolean;
    manualInvoicing: boolean;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};

export type BillingProps = {
    id: string;
    tenantId: string;
    plan: string;
    status: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    stripeTransactionId: string | null;
    pendingDowngradePlan: string | null;
    downgradeScheduledAt: Date | null;
    cancellationReason: string | null;
    cancellationRequestedAt: Date | null;
    cancellationEffectiveAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};

export type TenantUsageProps = {
    id: string;
    tenantId: string;
    metricName: string;
    periodDate: string;
    currentUsage: number;
    limitValue: number | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};