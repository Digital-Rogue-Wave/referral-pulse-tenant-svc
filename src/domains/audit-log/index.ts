import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

import { ListQueryDto } from '@common/http-contract/cursor-page';

export interface AuditLogProps {
    id: string;
    tenantId: string;
    actorUserId: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    reason: string | null;
    requestId: string | null;
    ipHash: string | null;
    before: unknown;
    after: unknown;
    occurredAt: Date;
}

/** `GET /v1/audit-log` filters, on top of the cursor (API Contract v1.3 §1). */
export class AuditLogQueryDto extends ListQueryDto {
    @ApiPropertyOptional({ example: 'api_key.revoked' })
    @IsOptional()
    @IsString()
    @Length(1, 100)
    action?: string;

    @ApiPropertyOptional({ example: 'api_key' })
    @IsOptional()
    @IsString()
    @Length(1, 50)
    targetType?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(1, 64)
    targetId?: string;

    @ApiPropertyOptional({ description: 'Operator id, `service:{client_id}` or `system`' })
    @IsOptional()
    @IsString()
    @Length(1, 80)
    actorUserId?: string;

    @ApiPropertyOptional({ format: 'date-time' })
    @IsOptional()
    @IsDateString()
    occurredAfter?: string;

    @ApiPropertyOptional({ format: 'date-time' })
    @IsOptional()
    @IsDateString()
    occurredBefore?: string;
}

/** One operator action. The client IP is kept only as a hash and is not returned. */
export class AuditLogResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    actorUserId!: string;

    @ApiProperty({ example: 'user.role_changed' })
    action!: string;

    @ApiPropertyOptional({ nullable: true, type: String })
    targetType!: string | null;

    @ApiPropertyOptional({ nullable: true, type: String })
    targetId!: string | null;

    @ApiPropertyOptional({ nullable: true, type: String })
    reason!: string | null;

    @ApiPropertyOptional({ nullable: true, type: String })
    requestId!: string | null;

    @ApiPropertyOptional({ nullable: true, type: Object })
    before!: unknown;

    @ApiPropertyOptional({ nullable: true, type: Object })
    after!: unknown;

    @ApiProperty()
    occurredAt!: Date;
}

export const toAuditLogResponse = (row: AuditLogProps): AuditLogResponse => ({
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    requestId: row.requestId,
    before: row.before ?? null,
    after: row.after ?? null,
    occurredAt: row.occurredAt
});
