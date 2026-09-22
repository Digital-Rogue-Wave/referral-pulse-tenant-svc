import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';

/**
 * One data-subject erasure, as the compliance orchestrator asks it of tenant-service (Product Spec v4 "DSR
 * Propagation"). The subject is named by their email hash (DB Model v2 `email_hash`: SHA-256 of the
 * lower-cased address) or, when the orchestrator already knows it, by the operator id.
 */
export class OperatorErasureDto {
    @ApiProperty({ description: 'The data-subject request this erasure belongs to; echoed in the receipt' })
    @IsString()
    @Length(1, 64)
    dsrId!: string;

    @ApiPropertyOptional({ description: 'SHA-256 hex of the lower-cased email address' })
    @ValidateIf((dto: OperatorErasureDto) => !dto.userId)
    @Matches(/^[0-9a-f]{64}$/, { message: 'subject_email_hash must be a lower-case SHA-256 hex digest' })
    subjectEmailHash?: string;

    @ApiPropertyOptional({ description: 'Operator id, when known' })
    @IsOptional()
    @IsString()
    @Length(26, 26)
    userId?: string;
}

export type ErasureStatus = 'completed' | 'not_found' | 'blocked';

/** The per-service receipt the orchestrator aggregates into `erasure.completed`. */
export class ErasureReceiptResponse {
    @ApiProperty()
    dsrId!: string;

    @ApiProperty({ example: 'tenant-service' })
    service!: string;

    @ApiProperty({ enum: ['completed', 'not_found', 'blocked'] })
    status!: ErasureStatus;

    @ApiProperty({ type: [String], description: 'Operator records anonymised (now or by an earlier request)' })
    erasedUserIds!: string[];

    @ApiPropertyOptional({ nullable: true, type: String, example: 'owner_of_active_tenant' })
    blockedReason!: string | null;

    @ApiProperty({ type: [String], description: 'What is kept, and on which basis' })
    retained!: string[];

    @ApiProperty()
    processedAt!: Date;
}
