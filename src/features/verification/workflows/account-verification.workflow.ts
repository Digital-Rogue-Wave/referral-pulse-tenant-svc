import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';

/** v5.2 Architecture §2.1: a review still open after seven days breaches the SLA. */
export const REVIEW_SLA = '7 days';

export interface AccountVerificationInput {
    tenantId: string;
    verificationId: string;
}

export interface AccountVerificationActivities {
    /** Raises the internal alert when the case is still `pending_review`; does nothing once decided. */
    reportSlaBreach(input: AccountVerificationInput): Promise<void>;
}

/** The Super Admin's decision, sent once it is written (US1.6.2 AC2). */
export const decidedSignal = defineSignal<[{ status: 'verified' | 'rejected' }]>('decided');

const { reportSlaBreach } = proxyActivities<AccountVerificationActivities>({
    startToCloseTimeout: '1 minute',
    retry: { maximumAttempts: 5 }
});

/**
 * `account_verification` (v5.2 Architecture §2.1, US1.6.1): one execution per company verification, from the provider's
 * callback (`pending_review`) to the Super Admin's decision. It holds the 7-day review SLA durably across restarts;
 * the decision itself is written by tenant-service before the signal, so the workflow never blocks a decision.
 */
export async function accountVerification(input: AccountVerificationInput): Promise<string> {
    const state: { decision: string | null } = { decision: null };
    setHandler(decidedSignal, ({ status }) => {
        state.decision = status;
    });
    if (!(await condition(() => state.decision !== null, REVIEW_SLA))) {
        await reportSlaBreach(input);
        await condition(() => state.decision !== null);
    }
    return state.decision ?? '';
}
