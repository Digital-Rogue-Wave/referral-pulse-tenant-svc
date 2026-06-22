import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsDateString, IsEnum } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Enums
// ============================================================

// Per referralai_event_model_v2.1.md §4.12 / referralai_db_tables_per_service.md
export enum ApiKeyType {
    SECRET = 'secret',
    PUBLISHABLE = 'publishable'
}

// ============================================================
// Props (shape of the Prisma model)
// ============================================================

export interface ApiKeyProps {
    id: string;
    tenantId: string;
    label: string;
    keyHash: string;
    keyPrefix: string;
    keyType: string;
    scopes: unknown;
    createdBy: string;
    lastUsedAt?: Date | null;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
}

// ============================================================
// DTOs
// ============================================================

export class CreateApiKeyDto {
    @ApiProperty()
    @IsString()
    label!: string;

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    scopes!: string[];

    @ApiPropertyOptional({ enum: ApiKeyType, default: ApiKeyType.SECRET })
    @IsOptional()
    @IsEnum(ApiKeyType)
    keyType?: ApiKeyType;

    @ApiPropertyOptional({ description: 'ISO 8601 expiry timestamp; omit for a non-expiring key' })
    @IsOptional()
    @IsDateString()
    expiresAt?: string;
}

export class UpdateApiKeyDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    label?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    scopes?: string[];
}

// ============================================================
// Responses
// ============================================================

export class ApiKeyResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty()
    label!: string;

    @ApiProperty()
    keyPrefix!: string;

    @ApiProperty({ enum: ApiKeyType })
    keyType!: string;

    @ApiProperty({ type: [String] })
    scopes!: unknown;

    @ApiProperty()
    createdBy!: string;

    @ApiPropertyOptional()
    lastUsedAt?: Date | null;

    @ApiPropertyOptional()
    expiresAt?: Date | null;

    @ApiPropertyOptional({ description: 'Set when the key is revoked (null = active)' })
    revokedAt?: Date | null;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty()
    updatedAt!: Date;

    @ApiPropertyOptional()
    deletedAt?: Date | null;
}

export class ApiKeyWithRawKeyResponse extends ApiKeyResponse {
    @ApiProperty({ description: 'Raw API key — shown only once at creation' })
    rawKey!: string;
}

// ============================================================
// Mapper
// ============================================================

class ApiKeyResponseMapper extends BaseResponseMapper<ApiKeyProps, ApiKeyResponse> {
    constructor() {
        super(ApiKeyResponse);
    }

    toResponseWithRawKey(entity: ApiKeyProps, rawKey: string): ApiKeyWithRawKeyResponse {
        const base = this.toResponse(entity);
        return Object.assign(new ApiKeyWithRawKeyResponse(), base, { rawKey });
    }
}

export const apiKeyResponseMapper = new ApiKeyResponseMapper();

// ============================================================
// Domain Events
// ============================================================

export class ApiKeyCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'api-key.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            apiKeyId: string;
            tenantId: string;
            label: string;
            keyPrefix: string;
            keyType: string;
            scopes: string[];
            createdBy: string;
            createdAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export class ApiKeyUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'api-key.updated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            apiKeyId: string;
            tenantId: string;
            changes: Record<string, { from: unknown; to: unknown }>;
            updatedBy: string;
            updatedAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export class ApiKeyDeletedEvent extends BaseDomainEvent {
    readonly eventType = 'api-key.deleted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            apiKeyId: string;
            tenantId: string;
            keyLabel: string;
            keyPrefix: string;
            deletedBy: string;
            deletedAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export const ApiKeyEvents = {
    CREATED: 'api-key.created',
    UPDATED: 'api-key.updated',
    DELETED: 'api-key.deleted'
} as const;
