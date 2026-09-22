import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsDateString, IsInt, Min, Max, IsNotEmpty, IsObject, Length, MaxLength } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';

// ============================================================
// Enums (canonical definition lives in tenant.types.ts)
// ============================================================

import { TenantStatus, VerificationRecordStatus, VerificationStatus, VerificationType } from './tenant.types';
export { TenantStatus, VerificationRecordStatus, VerificationStatus, VerificationType };

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
    customDomain?: string | null;

    @ApiPropertyOptional()
    domainVerificationStatus?: string | null;

    @ApiPropertyOptional()
    domainVerificationToken?: string | null;

    @ApiProperty({ example: 'eu-central-1' })
    dataRegion!: string;

    @ApiProperty({ minimum: 6, maximum: 36 })
    retentionMonths!: number;

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
}

export const tenantResponseMapper = new TenantResponseMapper();

// Re-export events for convenience
export * from './events/tenant.events';
