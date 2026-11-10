import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsDateString, IsEmail, IsInt, Min, Max, IsNotEmpty, IsObject, Length, MaxLength } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { InvitationResponse } from '@domains/invitation';

// ============================================================
// Enums (canonical definition lives in tenant.types.ts)
// ============================================================

import { InvitationChannel, TenantStatus, VerificationRecordStatus, VerificationStatus, VerificationType } from './tenant.types';
export { InvitationChannel, TenantStatus, VerificationRecordStatus, VerificationStatus, VerificationType };
export { defaultInvitationChannel, effectiveInvitationChannel } from './tenant.types';

// ============================================================
// Props (shape of the Prisma model)
// ============================================================

export interface TenantProps {
    id: string;
    name: string;
    slug: string;
    imageId?: string | null;
    status: string;
    verificationStatus: string;
    paymentStatus: string;
    paymentStatusChangedAt?: Date | null;
    trialStartedAt?: Date | null;
    trialEndsAt?: Date | null;
    suspendedAt?: Date | null;
    lockedAt?: Date | null;
    lockUntil?: Date | null;
    lockReason?: string | null;
    deletionScheduledAt?: Date | null;
    deletionReason?: string | null;
    deletionDueAt?: Date | null;
    customDomain?: string | null;
    domainVerificationStatus?: string | null;
    domainVerificationToken?: string | null;
    billingCountry?: string | null;
    invitationChannel?: string | null;
    dataRegion: string;
    retentionMonths: number;
    metadata?: unknown;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
}

// ============================================================
// Request DTOs
// ============================================================

export class CreateTenantDto {
    @ApiProperty()
    @IsString()
    name!: string;

    @ApiProperty()
    @IsString()
    slug!: string;
}

export class UpdateTenantDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    customDomain?: string;

    @ApiPropertyOptional({ minimum: 6, maximum: 36, description: 'Raw-data retention window in months (API §8.3)' })
    @IsOptional()
    @IsInt()
    @Min(6)
    @Max(36)
    retentionMonths?: number;

    @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 billing country — the input to the invitation-channel default' })
    @IsOptional()
    @IsString()
    @Length(2, 2)
    billingCountry?: string;

    /**
     * R-PRT-02's legal envelope. Owner-only: the service refuses it from any other role, because a
     * custom role flipping a jurisdiction gate is exactly what the rule exists to prevent.
     */
    @ApiPropertyOptional({ enum: InvitationChannel, description: 'Platform-sent invitations: allowed | forbidden (Owner only)' })
    @IsOptional()
    @IsEnum(InvitationChannel)
    invitationChannel?: InvitationChannel;
}

export class TransferOwnershipDto {
    @ApiProperty()
    @IsString()
    newOwnerId!: string;
}

export class ScheduleDeletionDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    reason?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(90)
    daysUntilDeletion?: number;
}

export class CancelDeletionDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    reason?: string;
}

export class LockTenantDto {
    @ApiProperty()
    @IsString()
    reason!: string;

    /**
     * The acting user's own password, re-confirmed via Ory Kratos. Locking a
     * tenant is destructive and not self-service reversible, so a valid session
     * alone is not sufficient authority — see REFER-353.
     */
    @ApiProperty({ description: "The acting user's password, re-confirmed before a destructive action" })
    @IsString()
    @IsNotEmpty()
    password!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    lockUntil?: string;
}

export class UnlockTenantDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    reason?: string;

    /** Re-confirmed for the same reason as locking — see {@link LockTenantDto.password}. */
    @ApiProperty({ description: "The acting user's password, re-confirmed before a destructive action" })
    @IsString()
    @IsNotEmpty()
    password!: string;
}

/** Platform-admin lock: a reason is mandatory (it is audited); `lock_until` makes it expire on its own. */
export class AdminLockTenantDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    @MaxLength(500)
    reason!: string;

    @ApiPropertyOptional({ format: 'date-time' })
    @IsOptional()
    @IsDateString()
    lockUntil?: string;
}

/** Platform-admin tenant creation (US1.1.1): the client's Owner joins through the invitation sent to `owner_email`. */
export class AdminCreateTenantDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name!: string;

    @ApiPropertyOptional({ description: 'Derived from the name when omitted' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(63)
    slug?: string;

    @ApiProperty()
    @IsEmail()
    ownerEmail!: string;
}

export class SuspendTenantDto {
    @ApiProperty()
    @IsString()
    reason!: string;
}

/**
 * The account_verification workflow's report on one verification. Without `verification_id` it applies to the
 * tenant's latest open verification of `verification_type` (a new one is opened when none is).
 */
export class UpdateVerificationStatusDto {
    @ApiProperty({ enum: VerificationRecordStatus })
    @IsEnum(VerificationRecordStatus)
    status!: VerificationRecordStatus;

    @ApiPropertyOptional({ enum: VerificationType, default: VerificationType.COMPANY })
    @IsOptional()
    @IsEnum(VerificationType)
    verificationType?: VerificationType;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(26, 26)
    verificationId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    reason?: string;

    @ApiPropertyOptional({ description: 'Operator id or `system` for an automated decision' })
    @IsOptional()
    @IsString()
    @MaxLength(80)
    reviewedBy?: string;

    @ApiPropertyOptional({ description: 'Temporal workflow id, so a crashed verification can be resumed' })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    temporalWorkflowId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(255)
    temporalRunId?: string;

    @ApiPropertyOptional({ description: 'References to uploaded documents — never the documents themselves' })
    @IsOptional()
    @IsObject()
    evidence?: Record<string, unknown>;
}

// ============================================================
// Responses
// ============================================================

export class TenantResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    name!: string;

    @ApiProperty()
    slug!: string;

    @ApiPropertyOptional()
    imageId?: string | null;

    @ApiProperty({ enum: TenantStatus })
    status!: string;

    @ApiProperty({ enum: VerificationStatus })
    verificationStatus!: string;

    @ApiProperty()
    paymentStatus!: string;

    @ApiPropertyOptional()
    paymentStatusChangedAt?: Date | null;

    @ApiPropertyOptional()
    trialStartedAt?: Date | null;

    @ApiPropertyOptional()
    trialEndsAt?: Date | null;

    @ApiPropertyOptional()
    suspendedAt?: Date | null;

    @ApiPropertyOptional()
    lockedAt?: Date | null;

    @ApiPropertyOptional()
    lockUntil?: Date | null;

    @ApiPropertyOptional()
    lockReason?: string | null;

    @ApiPropertyOptional()
    deletionScheduledAt?: Date | null;

    @ApiPropertyOptional()
    deletionReason?: string | null;

    @ApiPropertyOptional()
    deletionDueAt?: Date | null;

    @ApiPropertyOptional()
    customDomain?: string | null;

    @ApiPropertyOptional()
    domainVerificationStatus?: string | null;

    @ApiPropertyOptional()
    domainVerificationToken?: string | null;

    @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 billing country' })
    billingCountry?: string | null;

    @ApiPropertyOptional({ description: 'R-PRT-02 setting; null = no explicit choice (the platform default applies)' })
    invitationChannel?: string | null;

    @ApiProperty({ example: 'eu-central-1' })
    dataRegion!: string;

    @ApiProperty({ minimum: 6, maximum: 36 })
    retentionMonths!: number;

    @ApiPropertyOptional()
    metadata?: unknown;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty()
    updatedAt!: Date;

    @ApiPropertyOptional()
    deletedAt?: Date | null;
}

export class TenantProfileResponse extends TenantResponse {
    @ApiPropertyOptional()
    memberCount?: number;
}

export class DomainStatusResponse {
    @ApiProperty()
    customDomain!: string | null;

    @ApiProperty()
    domainVerificationStatus!: string | null;

    @ApiPropertyOptional()
    domainVerificationToken?: string | null;
}

export class SubdomainAvailabilityResponse {
    @ApiProperty()
    subdomain!: string;

    @ApiProperty()
    available!: boolean;

    @ApiPropertyOptional()
    message?: string;
}

export class DeletionScheduledResponse {
    @ApiProperty()
    tenantId!: string;

    @ApiProperty()
    deletionScheduledAt!: Date;

    @ApiProperty({ description: 'When the tenant and its data are deleted, unless the deletion is cancelled first' })
    deletionDueAt!: Date;

    @ApiPropertyOptional()
    deletionReason?: string | null;
}

export class TenantStatsDto {
    @ApiProperty()
    activeCampaigns!: number;

    @ApiProperty()
    totalReferrers!: number;

    @ApiProperty()
    totalReferralsThisMonth!: number;

    @ApiProperty()
    totalRevenue!: number;

    @ApiProperty()
    pendingPayouts!: number;

    @ApiProperty()
    planUsagePercentage!: number;
}

// ============================================================
// Mapper
// ============================================================

class TenantResponseMapper extends BaseResponseMapper<TenantProps, TenantResponse> {
    constructor() {
        super(TenantResponse);
    }

    /**
     * Explicit field list, as for API keys (NOTE.md K6): `widget_token_secret` is never part of a response
     * (it goes only to a service holding `widget_secret.read`), and a new column stays private until listed here.
     */
    override toResponse(entity: TenantProps): TenantResponse {
        return Object.assign(new TenantResponse(), {
            id: entity.id,
            name: entity.name,
            slug: entity.slug,
            imageId: entity.imageId ?? null,
            status: entity.status,
            verificationStatus: entity.verificationStatus,
            paymentStatus: entity.paymentStatus,
            paymentStatusChangedAt: entity.paymentStatusChangedAt ?? null,
            trialStartedAt: entity.trialStartedAt ?? null,
            trialEndsAt: entity.trialEndsAt ?? null,
            suspendedAt: entity.suspendedAt ?? null,
            lockedAt: entity.lockedAt ?? null,
            lockUntil: entity.lockUntil ?? null,
            lockReason: entity.lockReason ?? null,
            deletionScheduledAt: entity.deletionScheduledAt ?? null,
            deletionReason: entity.deletionReason ?? null,
            deletionDueAt: entity.deletionDueAt ?? null,
            customDomain: entity.customDomain ?? null,
            domainVerificationStatus: entity.domainVerificationStatus ?? null,
            domainVerificationToken: entity.domainVerificationToken ?? null,
            billingCountry: entity.billingCountry ?? null,
            invitationChannel: entity.invitationChannel ?? null,
            dataRegion: entity.dataRegion,
            retentionMonths: entity.retentionMonths,
            metadata: entity.metadata ?? null,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            deletedAt: entity.deletedAt ?? null
        });
    }
}

export const tenantResponseMapper = new TenantResponseMapper();

/** US1.1.1: the tenant a platform admin created, and the invitation its Owner joins through. */
export class AdminTenantCreatedResponse {
    @ApiProperty({ type: () => TenantResponse })
    tenant!: TenantResponse;

    @ApiProperty({ type: () => InvitationResponse })
    ownerInvitation!: InvitationResponse;
}

/**
 * API Contract §4.1's "shared secret" for widget identity tokens, as a service holding `widget_secret.read`
 * receives it (see `internal-widget-secret.controller.ts`). Within an hour of a rotation the replaced
 * secret comes too, so tokens signed just before the switch still verify.
 */
export class WidgetTokenSecretDto {
    @ApiProperty({ description: '32 bytes as 64 hex characters' })
    secret!: string;

    @ApiPropertyOptional({ description: 'The replaced secret, still accepted until previous_valid_until' })
    previousSecret?: string;

    @ApiPropertyOptional()
    previousValidUntil?: Date;
}

/** R-PRT-02's tenant-level envelope as a service holding `tenant_invitation_channel.read` receives it. */
export class TenantInvitationChannelDto {
    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: InvitationChannel, enumName: 'InvitationChannel', description: "The Owner's choice, or the billing country's default" })
    invitationChannel!: InvitationChannel;
}

/** The secret as the Owner reads or receives it after a rotation (US1.5.4 F2/F3). */
export class WidgetSecretResponse {
    @ApiProperty({ description: '32 bytes as 64 hex characters: sign the widget user JWT (HS256, 1-hour expiry) with it' })
    secret!: string;

    @ApiPropertyOptional({ description: 'Set after a rotation: until then, tokens signed with the previous secret still work' })
    previousValidUntil?: Date | null;
}

// Re-export events for convenience
export * from './events/tenant.events';
