import type { StartedWorkflow } from '../../../src/features/verification/account-verification.gateway';
import type { AccountVerificationInput } from '../../../src/features/verification/workflows';

/** Stands in for Temporal in the BDD suite: records what tenant-service started and signalled. */
export const fakeAccountVerificationGateway = {
    started: [] as AccountVerificationInput[],
    signalled: [] as { workflowId: string; status: string }[],

    start(input: AccountVerificationInput): Promise<StartedWorkflow> {
        this.started.push(input);
        return Promise.resolve({ workflowId: `account-verification-${input.verificationId}`, runId: `run-${input.verificationId}` });
    },

    signalDecided(workflowId: string, status: string): Promise<void> {
        this.signalled.push({ workflowId, status });
        return Promise.resolve();
    },

    reset(): void {
        this.started = [];
        this.signalled = [];
    }
};
