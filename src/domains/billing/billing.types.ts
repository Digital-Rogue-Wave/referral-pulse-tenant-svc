import type { Plan, Billing } from '@prisma-gen/generated/client';

export type PlanProps = Plan;
export type BillingProps = Billing;

export type PlanLimits = {
    referred_users?: number;
    campaigns?: number;
    seats?: number;
    leaderboard_entries?: number;
    email_sends?: number;
    [key: string]: number | undefined;
};
