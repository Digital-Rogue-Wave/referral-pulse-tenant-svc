import { ANALYSED_ALLOWED, FORBIDDEN_BY_DEFAULT } from '@config/legal/invitation-channel-defaults';

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
 * What the platform does when the Owner has made no choice: `allowed` only for a country the legal team has
 * analysed and cleared, `forbidden` for every other country and for an unknown one (E1 decision D9; the
 * lists live in `config/legal/invitation-channel-defaults.ts`). Kept as a function rather than a column
 * default so that correcting a tenant's billing country re-derives the right answer, and so "not chosen"
 * stays distinguishable from "chosen allowed".
 */
export const defaultInvitationChannel = (billingCountry: string | null | undefined): InvitationChannel => {
    const country = billingCountry?.toUpperCase();
    if (!country || FORBIDDEN_BY_DEFAULT.includes(country)) {
        return InvitationChannel.FORBIDDEN;
    }
    return ANALYSED_ALLOWED.includes(country) ? InvitationChannel.ALLOWED : InvitationChannel.FORBIDDEN;
};

/** Whether the effective channel is the Owner's own choice or the platform default. */
export type InvitationChannelSource = 'explicit' | 'default';

/** The value every other service must honour: the Owner's choice, or the platform default. */
export const invitationChannelSource = (tenant: { invitationChannel?: string | null }): InvitationChannelSource =>
    tenant.invitationChannel === InvitationChannel.ALLOWED || tenant.invitationChannel === InvitationChannel.FORBIDDEN ? 'explicit' : 'default';

export const effectiveInvitationChannel = (tenant: { invitationChannel?: string | null; billingCountry?: string | null }): InvitationChannel =>
    tenant.invitationChannel === InvitationChannel.ALLOWED || tenant.invitationChannel === InvitationChannel.FORBIDDEN
        ? tenant.invitationChannel
        : defaultInvitationChannel(tenant.billingCountry);
