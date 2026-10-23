import type { ServicesConfig } from '@config/services.config';

/** The `services.*` entries that hold a target's base URL. */
type ServiceUrlKey = Exclude<keyof ServicesConfig, 'auth'>;

export interface ErasureTarget {
    /** Stored as `dsr_receipts.service_name` and published in `erasure.completed`. */
    serviceName: string;
    /** Where to reach it, or `null` for this service's own share, which runs in-process. */
    configKey: ServiceUrlKey | null;
    /** What R-CPL-02 says this service does with the subject's data — echoed to the subject. */
    share: string;
}

/**
 * The erasure fan-out, exactly as Product Spec R-CPL-02 lists it. Six targets, in its order.
 *
 * Identity is this service, so its share runs in-process through `OperatorErasureService` rather than
 * as an HTTP call to itself: it is the same handler either way, and a self-call would need this service
 * to mint a token for its own endpoint.
 *
 * The remaining five are reached at `POST {base}/api/v1/internal/erasures/subjects`, with this
 * service's own `/internal/erasures/operators` as the shape — because no v5 document specifies that
 * contract, and R-CPL-01 makes the orchestrator the one place it can be stated. It is a proposal going
 * back as a spec patch, not a contract being implemented (NOTE.md §V5.16), which is why a target that
 * answers 404 leaves a `pending` receipt rather than failing the request: the fan-out records who has
 * not answered, and a retry resumes there once the endpoint exists.
 */
export const ERASURE_TARGETS: readonly ErasureTarget[] = [
    {
        serviceName: 'tenant-service',
        configKey: null,
        share: 'Identity: anonymise user record'
    },
    {
        serviceName: 'referral-workflow-service',
        configKey: 'referrals',
        share: 'Referral Workflow: anonymise touches, invitations, participant/invitee profiles — keep aggregate counts'
    },
    {
        serviceName: 'reward-service',
        configKey: 'rewards',
        share: 'Rewards: retain ledger under legal obligation, pseudonymise identity'
    },
    {
        serviceName: 'analytics-service',
        configKey: 'analytics',
        share: 'Analytics: purge PII linkage; aggregates survive'
    },
    {
        serviceName: 'ai-service',
        configKey: 'contentAi',
        share: 'AI: drop subject from feature store + decision logs → hashed tokens'
    },
    {
        serviceName: 'notification-service',
        configKey: 'notifications',
        share: 'Notifications: signal payout provider / connectors to delete where applicable'
    }
] as const;

/** The path every remote target hosts, mirroring this service's own erasure handler. */
export const REMOTE_ERASURE_PATH = '/api/v1/internal/erasures/subjects';
