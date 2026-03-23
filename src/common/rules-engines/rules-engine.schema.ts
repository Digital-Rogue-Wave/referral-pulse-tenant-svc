import { RuleProperties } from 'json-rules-engine';

/**
 * Type alias representing the structure of a rule in the system.
 * This extends RuleProperties from json-rules-engine.
 */
export type IRewardRule = RuleProperties;

/**
 * Facts used by the rules engine for evaluation.
 */
export interface IRewardFacts {
    conversionValue: number;
    referrerStats: {
        totalReferrals: number;
        successfulReferrals: number;
        lastReferralDate: string | null;
    };
    conversionContext: {
        platform: string;
        productCategory: string;
        isFirstPurchase: boolean;
        ip?: string;
        deviceFingerprint?: string;
    };
    fraudRisk: {
        score: number;
        flags: string[];
    };
    campaign: {
        budgetRemaining: number;
        daysActive: number;
    };
}
