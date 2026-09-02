import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsDateString, IsInt, Min, IsNotEmpty } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';

// ============================================================
// Enums (canonical definition lives in tenant.types.ts)
// ============================================================

import { TenantStatus, VerificationStatus } from './tenant.types';
export { TenantStatus, VerificationStatus };

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
    customDomain?: string | null;
    domainVerificationStatus?: string | null;
    domainVerificationToken?: string | null;
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

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    ownerId?: string;
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

export class UpdateVerificationStatusDto {
    @ApiProperty({ enum: VerificationStatus })
    @IsEnum(VerificationStatus)
    status!: VerificationStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    reason?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    reviewedBy?: string;
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
