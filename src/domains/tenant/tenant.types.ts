/**
 * Tenant lifecycle status (DB Model §3 `tenants.status`). `locked` is this service's additive value for the
 * self-service lock; `closed` is terminal (the tenant was deleted and its PII purged).
 * Payment access tiers live in `payment_status`, not here.
 */
export enum TenantStatus {
    ACTIVE = 'active',
    SUSPENDED = 'suspended',
    LOCKED = 'locked',
    CLOSED = 'closed'
}

/**
 * Company (client account) verification status.
 * Owned by this service per referralai_system_architecture_v1.md §Company Verification;
 * transitions are driven by the workflow service's `account_verification` Temporal workflow.
 */
export enum VerificationStatus {
    UNVERIFIED = 'unverified',
    PENDING = 'pending',
    VERIFIED = 'verified',
    REJECTED = 'rejected'
}

/** What a `tenant_verifications` row verifies (DB Model §3). Only `company` drives the tenant's status. */
export enum VerificationType {
    COMPANY = 'company',
    TAX = 'tax',
    PAYOUT_PROVIDER = 'payout_provider'
}

/** A verification's own state; `pending` and `in_review` both show the tenant as `pending`. */
export enum VerificationRecordStatus {
    PENDING = 'pending',
    IN_REVIEW = 'in_review',
    VERIFIED = 'verified',
    REJECTED = 'rejected'
}

/**
 * R-PRT-02's legal envelope for platform-sent invitations ("invite by email" in the widget).
 *
 * Owner-only, and the tenant level carries the *jurisdiction* while the campaign level
 * (`invitations_enabled`, campaign-service) carries the use case. A campaign can never enable what
 * the tenant forbids.
 */
export enum InvitationChannel {
    ALLOWED = 'allowed',
    FORBIDDEN = 'forbidden'
}

/**
 * The jurisdiction whose law makes platform-sent tell-a-friend email unlawful by default: under
 * BGH 2013 (Empfehlungs-E-Mail) such mail is unsolicited advertising attributable to the company.
 * R-PRT-02 names Germany specifically; the same channel is lawful elsewhere in the EU under
 * legitimate interest with minimisation.
 */
const FORBIDDEN_BY_DEFAULT_COUNTRIES: readonly string[] = ['DE'];

/**
 * What the platform does when the Owner has made no choice. Kept as a function rather than a column
 * default so that correcting a tenant's billing country re-derives the right answer, and so "not
 * chosen" stays distinguishable from "chosen allowed".
 */
export const defaultInvitationChannel = (billingCountry: string | null | undefined): InvitationChannel =>
    billingCountry && FORBIDDEN_BY_DEFAULT_COUNTRIES.includes(billingCountry.toUpperCase())
        ? InvitationChannel.FORBIDDEN
        : InvitationChannel.ALLOWED;

/** The value every other service must honour: the Owner's choice, or the platform default. */
export const effectiveInvitationChannel = (tenant: {
    invitationChannel?: string | null;
    billingCountry?: string | null;
}): InvitationChannel =>
    tenant.invitationChannel === InvitationChannel.ALLOWED || tenant.invitationChannel === InvitationChannel.FORBIDDEN
        ? tenant.invitationChannel
        : defaultInvitationChannel(tenant.billingCountry);
