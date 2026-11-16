import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { VerificationRecordStatus } from '@domains/tenant/tenant.types';

/** One company verification, as the Owner sees it (`GET /v1/verification`, E1 D15). No reviewer id: internal. */
export class CompanyVerificationSummary {
    @ApiProperty()
    id!: string;

    @ApiProperty({ enum: VerificationRecordStatus })
    status!: string;

    @ApiPropertyOptional({ nullable: true, description: 'Why it was rejected' })
    reason!: string | null;

    @ApiPropertyOptional({ nullable: true })
    provider!: string | null;

    @ApiProperty()
    submittedAt!: string;

    @ApiPropertyOptional({ nullable: true })
    reviewedAt!: string | null;
}

export class CompanyVerificationResponse {
    @ApiProperty({ enum: ['unverified', 'pending', 'verified', 'rejected'], description: "The tenant's verification status" })
    status!: string;

    @ApiPropertyOptional({ type: CompanyVerificationSummary, nullable: true, description: 'The latest company verification, if any' })
    verification!: CompanyVerificationSummary | null;
}

/** `POST /v1/verification`: where the Owner completes the provider's check. */
export class VerificationSessionResponse {
    @ApiProperty({ enum: ['pending'] })
    status!: string;

    @ApiProperty()
    verificationId!: string;

    @ApiProperty()
    provider!: string;

    @ApiProperty({ description: "The provider's hosted verification page" })
    providerUrl!: string;
}

/** A verification in the Super Admin's review list (E1 D15, US1.6.2). */
export class AdminVerificationResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty()
    tenantName!: string;

    @ApiProperty({ enum: VerificationRecordStatus })
    status!: string;

    @ApiPropertyOptional({ nullable: true })
    reason!: string | null;

    @ApiProperty()
    submittedAt!: string;

    @ApiPropertyOptional({ nullable: true })
    reviewedAt!: string | null;

    @ApiPropertyOptional({ nullable: true })
    reviewedBy!: string | null;
}

/** One verification with its evidence: the provider's reference and result. Reading it is audit-logged. */
export class AdminVerificationDetailResponse extends AdminVerificationResponse {
    @ApiPropertyOptional({ nullable: true, type: Object })
    evidence!: Record<string, unknown> | null;
}

export class AdminVerificationQueryDto {
    @ApiPropertyOptional({ enum: VerificationRecordStatus, default: VerificationRecordStatus.IN_REVIEW })
    @IsOptional()
    @IsEnum(VerificationRecordStatus)
    status?: VerificationRecordStatus;
}

export class RejectVerificationDto {
    @ApiProperty({ minLength: 3, maxLength: 1000 })
    @IsString()
    @MinLength(3)
    @MaxLength(1000)
    reason!: string;
}
