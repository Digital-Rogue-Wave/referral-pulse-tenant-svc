import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsDateString, IsEnum } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Enums
// ============================================================

export enum ApiKeyStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    REVOKED = 'revoked',
}

// ============================================================
// Props (shape of the Prisma model)
// ============================================================

export interface ApiKeyProps {
    id: string;
    tenantId: string;
    name: string;
    keyHash: string;
    keyPrefix: string;
    status: string;
    scopes: unknown;
    createdBy: string;
    lastUsedAt?: Date | null;
    expiresAt?: Date | null;
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
    name!: string;

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    scopes!: string[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    expiresAt?: Date;
}

export class UpdateApiKeyDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    name?: string;

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
    name!: string;

    @ApiProperty()
    keyPrefix!: string;

    @ApiProperty({ enum: ApiKeyStatus })
    status!: string;

    @ApiProperty({ type: [String] })
    scopes!: unknown;

    @ApiProperty()
    createdBy!: string;

    @ApiPropertyOptional()
    lastUsedAt?: Date | null;

    @ApiPropertyOptional()
    expiresAt?: Date | null;

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
            name: string;
            keyPrefix: string;
            scopes: string[];
            createdBy: string;
            createdAt: Date;
        },
        public readonly userId?: string,
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
        public readonly userId?: string,
    ) {
        super();
    }
}

export class ApiKeyStatusUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'api-key.status' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            apiKeyId: string;
            tenantId: string;
            previousStatus: string;
            newStatus: string;
            updatedBy: string;
            updatedAt: Date;
        },
        public readonly userId?: string,
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
            keyName: string;
            keyPrefix: string;
            deletedBy: string;
            deletedAt: Date;
        },
        public readonly userId?: string,
    ) {
        super();
    }
}

export const ApiKeyEvents = {
    CREATED: 'api-key.created',
    UPDATED: 'api-key.updated',
    STATUS: 'api-key.status',
    DELETED: 'api-key.deleted',
} as const;
