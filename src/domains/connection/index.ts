import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Enums
// ============================================================

/**
 * The providers a connection may be for. This is DB Model v5 §10's CHECK list on
 * `inbound_webhook_receipts.provider`, so a connection and the receipt a callback produces cannot
 * disagree about who sent it.
 *
 * API Contract §6.5's revision line names `tremendous` in place of `gift_card` and omits `crm`, while
 * the table directly below it lists "Gift-card (Tremendous/Tango)" and "CRM (HubSpot/Salesforce)".
 * Two of the three mentions name categories, so categories win — recorded in NOTE.md §V5.13.
 */
export enum ConnectionProvider {
    STRIPE = 'stripe',
    PADDLE = 'paddle',
    CHARGEBEE = 'chargebee',
    PAYPAL = 'paypal',
    WISE = 'wise',
    GIFT_CARD = 'gift_card',
    CRM = 'crm'
}

/** The three kinds Architecture §2.1 names: "billing, payout, CRM". */
export enum ConnectionType {
    BILLING = 'billing',
    PAYOUT = 'payout',
    CRM = 'crm'
}

export const isConnectionProvider = (value: string): value is ConnectionProvider => (Object.values(ConnectionProvider) as string[]).includes(value);

// ============================================================
// Props (shape of the Prisma model)
// ============================================================

export interface ConnectionProps {
    id: string;
    tenantId: string;
    provider: string;
    connectionType: string;
    name?: string | null;
    signingSecret?: string | null;
    config: unknown;
    enabled: boolean;
    createdBy?: string | null;
    createdAt: Date;
    updatedAt: Date;
    revokedAt?: Date | null;
}

// ============================================================
// DTOs
// ============================================================

/**
 * `POST /v1/connections` is named by API Contract §6.5 but its body is marked "to author in §3.1", so
 * this shape is this service's proposal rather than a contract being implemented (NOTE.md §V5.13).
 */
export class CreateConnectionDto {
    @ApiProperty({ enum: ConnectionProvider })
    @IsEnum(ConnectionProvider)
    provider!: ConnectionProvider;

    @ApiProperty({ enum: ConnectionType })
    @IsEnum(ConnectionType)
    connectionType!: ConnectionType;

    @ApiPropertyOptional({ maxLength: 100, description: 'Operator-facing label' })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    name?: string;

    @ApiProperty({
        description: 'The secret the provider signs its callbacks with. Stored encrypted and never returned by any read endpoint.',
        minLength: 16,
        maxLength: 500
    })
    @IsString()
    @Length(16, 500)
    signingSecret!: string;

    @ApiPropertyOptional({
        description: 'Provider settings that are not secrets — e.g. PayPal webhookId, Chargebee allowedIps',
        type: 'object',
        additionalProperties: true
    })
    @IsOptional()
    @IsObject()
    config?: Record<string, unknown>;
}

// ============================================================
// Responses
// ============================================================

export class ConnectionResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: ConnectionProvider })
    provider!: string;

    @ApiProperty({ enum: ConnectionType })
    connectionType!: string;

    @ApiPropertyOptional()
    name?: string | null;

    @ApiProperty({ description: 'Where the provider sends its callbacks' })
    receiverUrl!: string;

    @ApiProperty({ type: 'object', additionalProperties: true })
    config!: Record<string, unknown>;

    @ApiProperty()
    enabled!: boolean;

    @ApiProperty()
    createdAt!: Date;

    @ApiPropertyOptional({ description: 'Set when the connection is revoked (null = live)' })
    revokedAt?: Date | null;
}

/** What Event Ingestion caches to verify a provider callback (Product Spec §12: "connection config … cache from Identity & Access"). */
export class InternalConnectionDto {
    @ApiProperty()
    connectionId!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: ConnectionProvider })
    provider!: string;

    @ApiProperty({ enum: ConnectionType })
    connectionType!: string;

    @ApiProperty({ nullable: true, description: 'Decrypted signing secret — the only endpoint that returns it' })
    signingSecret!: string | null;

    @ApiProperty({ type: 'object', additionalProperties: true })
    config!: Record<string, unknown>;

    @ApiProperty()
    enabled!: boolean;
}

/** The key `/t/o` and `/t/c` tokens are signed and verified with (Architecture §2.1). */
export class TrackingTokenKeyDto {
    @ApiProperty({ description: '32 bytes as 64 hex characters' })
    key!: string;
}

// ============================================================
// Mapper
// ============================================================

class ConnectionResponseMapper extends BaseResponseMapper<ConnectionProps, ConnectionResponse> {
    constructor() {
        super(ConnectionResponse);
    }

    /** Explicit field list: `signingSecret` is never part of a response. */
    override toResponse(entity: ConnectionProps): ConnectionResponse {
        return Object.assign(new ConnectionResponse(), {
            id: entity.id,
            tenantId: entity.tenantId,
            provider: entity.provider,
            connectionType: entity.connectionType,
            name: entity.name ?? null,
            receiverUrl: receiverPath(entity.provider, entity.id),
            config: (entity.config ?? {}) as Record<string, unknown>,
            enabled: entity.enabled,
            createdAt: entity.createdAt,
            revokedAt: entity.revokedAt ?? null
        });
    }
}

export const connectionResponseMapper = new ConnectionResponseMapper();

/** API Contract §6.5 / Architecture §2.4 — the path Event Ingestion hosts, not this service. */
export const receiverPath = (provider: string, connectionId: string): string => `/inbound/${provider}/${connectionId}`;

// ============================================================
// Domain Events
// ============================================================

/** Product Spec §12 lists `connection.created|revoked` among Identity & Access's published events. */
export class ConnectionCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'connection.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: { connectionId: string; provider: string; connectionType: string; createdBy: string },
        public readonly userId?: string
    ) {
        super();
    }
}

export class ConnectionRevokedEvent extends BaseDomainEvent {
    readonly eventType = 'connection.revoked' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: { connectionId: string; provider: string; revokedBy: string },
        public readonly userId?: string
    ) {
        super();
    }
}

export const ConnectionEvents = {
    CREATED: 'connection.created',
    REVOKED: 'connection.revoked'
} as const;
