/** Injection token of the configured provider (E1 D15). */
export const KYB_PROVIDER = Symbol('KYB_PROVIDER');

/**
 * The applicant id this platform gives the provider, and gets back on every result: `{tenantId}:{verificationId}`, so
 * Event Ingestion can route a result to its tenant without a lookup and tenant-svc can find the exact verification.
 */
export const kybExternalUserId = (tenantId: string, verificationId: string): string => `${tenantId}:${verificationId}`;

export interface KybSession {
    /** Which provider holds the case. */
    provider: string;
    /** The applicant id given to the provider (see `kybExternalUserId`). */
    externalUserId: string;
    /** The provider's hosted verification page the Owner completes. */
    url: string;
}

/**
 * A KYB provider behind one adapter (Product Spec R-INT-02, E1 D15): it opens a hosted session for a company. Its
 * results come back as provider webhooks through Event Ingestion, never through this adapter.
 */
export interface KybProvider {
    readonly name: string;
    openSession(tenantId: string, verificationId: string): Promise<KybSession>;
}
