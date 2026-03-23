export type PlanLimits = {
    referred_users?: number;
    campaigns?: number;
    seats?: number;
    leaderboard_entries?: number;
    email_sends?: number;
    [key: string]: number | undefined;
};

export function assertValidPlanLimits(limits: PlanLimits | null | undefined): void {
    if (!limits) {
        return;
    }

    const entries = Object.entries(limits) as [keyof PlanLimits, number | undefined][];

    for (const [key, value] of entries) {
        if (value === null || value === undefined) {
            continue;
        }
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`Invalid plan limit for ${String(key)}: ${value}`);
        }
    }
}