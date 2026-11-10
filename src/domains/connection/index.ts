import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Enums
// ============================================================

/**
 * The providers a connection may be for: real vendors, not categories (US1.5.1 F7, v5.1). The platform calls
 * each provider's own API for payouts and gift cards (Payout Model R-PAY-01/03, R-RWD-07), so it must know which
 * one it is. Mirrored by event-svc's `InboundProvider` and the CHECK on its `inbound_webhook_receipts.provider`,
 * so a connection and the receipt its callback produces cannot disagree about who sent it.
 * Replaced the categories `gift_card` (→ `tremendous`) and `crm` (→ `hubspot` | `salesforce`) on 2026-11-10.
 */
export enum ConnectionProvider {
    STRIPE = 'stripe',
    PADDLE = 'paddle',
    CHARGEBEE = 'chargebee',
    PAYPAL = 'paypal',
    WISE = 'wise',
    TREMENDOUS = 'tremendous',
    HUBSPOT = 'hubspot',
    SALESFORCE = 'salesforce'
}

/** What a connection is for (US1.5.1 F7): billing, payout, gift card or CRM. Derived from the provider. */
export enum ConnectionType {
    BILLING = 'billing',
    PAYOUT = 'payout',
    GIFT_CARD = 'gift_card',
    CRM = 'crm'
}

/** Each provider belongs to exactly one type (US1.5.1 F5), so a client can't pair Paddle with CRM. */
export const CONNECTION_TYPE_OF: Readonly<Record<ConnectionProvider, ConnectionType>> = {
    [ConnectionProvider.STRIPE]: ConnectionType.BILLING,
    [ConnectionProvider.PADDLE]: ConnectionType.BILLING,
    [ConnectionProvider.CHARGEBEE]: ConnectionType.BILLING,
    [ConnectionProvider.PAYPAL]: ConnectionType.PAYOUT,
    [ConnectionProvider.WISE]: ConnectionType.PAYOUT,
    [ConnectionProvider.TREMENDOUS]: ConnectionType.GIFT_CARD,
    [ConnectionProvider.HUBSPOT]: ConnectionType.CRM,
    [ConnectionProvider.SALESFORCE]: ConnectionType.CRM
};

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

    @ApiPropertyOptional({
        enum: ConnectionType,
        description: 'Derived from the provider; when sent it must match it (US1.5.1 F5), otherwise 400'
    })
    @IsOptional()
    @IsEnum(ConnectionType)
    connectionType?: ConnectionType;

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

    @ApiProperty({
        description: 'Where the provider sends its callbacks: absolute when INBOUND_PUBLIC_BASE_URL is set, so the Owner can paste it as is'
    })
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
        public readonly payload: { connectionId: string; provider: string; connectionType: string; revokedBy: string },
        public readonly userId?: string
    ) {
        super();
    }
}

export const ConnectionEvents = {
    CREATED: 'connection.created',
    REVOKED: 'connection.revoked'
} as const;

/**
 * US1.5.3 F2 — the revocation marker, a contract with Event Ingestion (event-svc `ConnectionCacheService`).
 * Written by tenant-service when a connection is revoked, in the Redis both services share and outside either
 * service's key prefix, so Ingestion refuses a connection it still holds in its cache at once instead of after
 * its cache TTL (300 s by default). Revocation is permanent, so the marker only has to outlive that cache entry.
 */
export const revokedConnectionMarkerKey = (connectionId: string): string => `connection-revoked:${connectionId}`;
export const REVOKED_CONNECTION_MARKER_TTL_SECONDS = 3600;
