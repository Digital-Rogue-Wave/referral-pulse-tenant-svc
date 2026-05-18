export class PlanResponse {
    id!: string;
    name!: string;
    stripePriceId?: string | null;
    stripeProductId?: string | null;
    interval?: string | null;
    limits?: Record<string, unknown> | null;
    isActive!: boolean;
    manualInvoicing!: boolean;
    createdAt!: Date;
    updatedAt!: Date;
}

export class BillingResponse {
    id!: string;
    tenantId!: string;
    plan!: string;
    status!: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    pendingDowngradePlan?: string | null;
    downgradeScheduledAt?: Date | null;
    cancellationReason?: string | null;
    cancellationRequestedAt?: Date | null;
    cancellationEffectiveAt?: Date | null;
    createdAt!: Date;
    updatedAt!: Date;
}

export class TenantUsageResponse {
    id!: string;
    tenantId!: string;
    metricName!: string;
    periodDate!: string;
    currentUsage!: number;
    limitValue?: number | null;
}