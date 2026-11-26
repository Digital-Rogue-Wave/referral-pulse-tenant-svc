import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';

import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Enums
// ============================================================

/**
 * The providers a Connection may be for (v5.2 API §3.16, DB §3 `connections.provider`). Real vendors, not categories:
 * the platform calls each provider's own API, so it must know which one it is. The eight that send callbacks are
 * mirrored by event-svc's `InboundProvider`; `zapier` has no receiver (it is outbound through webhook subscriptions).
 */
export enum ConnectionProvider {
    STRIPE = 'stripe',
    PADDLE = 'paddle',
    CHARGEBEE = 'chargebee',
    PAYPAL = 'paypal',
    WISE = 'wise',
    TREMENDOUS = 'tremendous',
    HUBSPOT = 'hubspot',
    SALESFORCE = 'salesforce',
    ZAPIER = 'zapier'
}

/** v5.2 API §3.16: inbound (provider → platform webhooks), outbound (platform → provider calls) or both. */
export enum ConnectionDirection {
    INBOUND = 'inbound',
    OUTBOUND = 'outbound',
    BOTH = 'both'
}

/** v5.2 DB §3 `connections.status`: pending until the first verified callback or a successful outbound test. */
export enum ConnectionStatus {
    PENDING_VERIFICATION = 'pending_verification',
    ACTIVE = 'active',
    REVOKED = 'revoked'
}

/**
 * The provider matrix fixes the direction (v5.2 tracker US1.5.1 AC3, API §3.16): billing providers send webhooks;
 * payout providers are called and send status callbacks; CRMs send contacts and receive leads; Zapier only receives,
 * through `POST /v1/webhooks`.
 */
export const DIRECTION_OF: Readonly<Record<ConnectionProvider, ConnectionDirection>> = {
    [ConnectionProvider.STRIPE]: ConnectionDirection.INBOUND,
    [ConnectionProvider.PADDLE]: ConnectionDirection.INBOUND,
    [ConnectionProvider.CHARGEBEE]: ConnectionDirection.INBOUND,
    [ConnectionProvider.PAYPAL]: ConnectionDirection.BOTH,
    [ConnectionProvider.WISE]: ConnectionDirection.BOTH,
    [ConnectionProvider.TREMENDOUS]: ConnectionDirection.BOTH,
    [ConnectionProvider.HUBSPOT]: ConnectionDirection.BOTH,
    [ConnectionProvider.SALESFORCE]: ConnectionDirection.BOTH,
    [ConnectionProvider.ZAPIER]: ConnectionDirection.OUTBOUND
};

export const isConnectionProvider = (value: string): value is ConnectionProvider => (Object.values(ConnectionProvider) as string[]).includes(value);

export const receivesCallbacks = (direction: string): boolean => direction === ConnectionDirection.INBOUND || direction === ConnectionDirection.BOTH;

/** v5.2 API §3.16: "old secret honoured for 24 h" after a rotation. */
export const PREVIOUS_SIGNING_SECRET_GRACE_MS = 24 * 60 * 60 * 1000;

// ============================================================
// Props (shape of the Prisma model)
// ============================================================

export interface ConnectionProps {
    id: string;
    tenantId: string;
    provider: string;
    direction: string;
    status: string;
    name?: string | null;
    credentialsEncrypted?: string | null;
    signingSecretEncrypted?: string | null;
    previousSigningSecretEncrypted?: string | null;
    previousSecretValidUntil?: Date | null;
    config: unknown;
    lastVerifiedAt?: Date | null;
    lastSyncAt?: Date | null;
    createdBy?: string | null;
    createdAt: Date;
    updatedAt: Date;
    revokedAt?: Date | null;
}

/** What `credentials_encrypted` holds once opened: the outbound credentials, never the inbound signing secret. */
export interface OutboundCredentials {
    apiKey?: string;
    oauthCode?: string;
}

// ============================================================
// DTOs
// ============================================================

/**
 * v5.2 API §3.16 `credentials`: write-only, never returned. Which fields a provider takes:
 * - `signing_secret`: the inbound webhook secret (Stripe, Paddle, Tremendous; the CRM bearer token; the PayPal app
 *   secret its verify API needs);
 * - `basic_auth_user` + `basic_auth_password`: Chargebee (with the provider IP allowlist in `config.allowed_ips`);
 * - `api_key` or `oauth_code`: the outbound credential of a payout provider or a CRM.
 */
export class ConnectionCredentialsDto {
    @ApiPropertyOptional({ minLength: 16, maxLength: 500 })
    @IsOptional()
    @IsString()
    @Length(16, 500)
    signingSecret?: string;

    @ApiPropertyOptional({ maxLength: 200 })
    @IsOptional()
    @IsString()
    @Length(1, 200)
    basicAuthUser?: string;

    @ApiPropertyOptional({ maxLength: 200 })
    @IsOptional()
    @IsString()
    @Length(8, 200)
    basicAuthPassword?: string;

    @ApiPropertyOptional({ maxLength: 2000 })
    @IsOptional()
    @IsString()
    @Length(8, 2000)
    apiKey?: string;

    @ApiPropertyOptional({ maxLength: 2000 })
    @IsOptional()
    @IsString()
    @Length(8, 2000)
    oauthCode?: string;
}

/** v5.2 API §3.16 `POST /v1/connections`. */
export class CreateConnectionDto {
    @ApiProperty({ enum: ConnectionProvider })
    @IsEnum(ConnectionProvider)
    provider!: ConnectionProvider;

    @ApiPropertyOptional({
        enum: ConnectionDirection,
        description: 'Fixed by the provider matrix; when sent it must match it, otherwise 400'
    })
    @IsOptional()
    @IsEnum(ConnectionDirection)
    direction?: ConnectionDirection;

    @ApiPropertyOptional({ maxLength: 100, description: 'Operator-facing label (not in the v5.2 contract)' })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    name?: string;

    @ApiPropertyOptional({ type: ConnectionCredentialsDto, description: 'Write-only; required except for Zapier' })
    @IsOptional()
    @ValidateNested()
    @Type(() => ConnectionCredentialsDto)
    credentials?: ConnectionCredentialsDto;

    @ApiPropertyOptional({
        description: 'Provider settings that are not secrets — e.g. PayPal client_id / webhook_id, Chargebee allowed_ips',
        type: 'object',
        additionalProperties: true
    })
    @IsOptional()
    @IsObject()
    config?: Record<string, unknown>;
}

/** v5.2 API §3.16 `POST /v1/connections/{id}/rotate`: the replacement credentials, any subset the provider takes. */
export class RotateConnectionDto {
    @ApiProperty({ type: ConnectionCredentialsDto })
    @ValidateNested()
    @Type(() => ConnectionCredentialsDto)
    credentials!: ConnectionCredentialsDto;
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

    @ApiProperty({ enum: ConnectionDirection })
    direction!: string;

    @ApiProperty({ enum: ConnectionStatus })
    status!: string;

    @ApiPropertyOptional()
    name?: string | null;

    @ApiPropertyOptional({
        description: 'Inbound and both only: where the provider sends its callbacks; absolute when INBOUND_PUBLIC_BASE_URL is set'
    })
    inboundUrl?: string;

    @ApiProperty({ type: 'object', additionalProperties: true })
    config!: Record<string, unknown>;

    @ApiPropertyOptional({ nullable: true })
    lastVerifiedAt?: Date | null;

    @ApiPropertyOptional({ nullable: true })
    lastSyncAt?: Date | null;

    @ApiPropertyOptional({ nullable: true, description: 'Set while a rotated signing secret is still honoured' })
    previousSecretValidUntil?: Date | null;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty()
    updatedAt!: Date;

    @ApiPropertyOptional({ nullable: true, description: 'Set when the connection is revoked' })
    revokedAt?: Date | null;
}

/** `POST /v1/connections/{id}/test`: the outbound check's outcome. */
export class ConnectionTestResponse {
    @ApiProperty()
    connectionId!: string;

    @ApiProperty()
    ok!: boolean;

    @ApiPropertyOptional({ nullable: true, description: 'Why the check failed (provider status, missing setting); never a credential' })
    failure?: string | null;

    @ApiProperty({ enum: ConnectionStatus })
    status!: string;

    @ApiProperty()
    checkedAt!: Date;
}

/**
 * What Event Ingestion caches to verify a provider callback: the inbound signing secret only — never an outbound
 * credential (v5.2 US1.5.4 AC1). The previous secret is present only while its 24 hours last.
 */
export class InternalConnectionDto {
    @ApiProperty()
    connectionId!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: ConnectionProvider })
    provider!: string;

    @ApiProperty({ enum: ConnectionDirection })
    direction!: string;

    @ApiProperty({ enum: ConnectionStatus })
    status!: string;

    @ApiProperty({ nullable: true, description: 'Decrypted inbound signing secret' })
    signingSecret!: string | null;

    @ApiProperty({ nullable: true, description: 'The rotated-out secret, while it is still honoured' })
    previousSigningSecret!: string | null;

    @ApiProperty({ nullable: true })
    previousSecretValidUntil!: Date | null;

    @ApiProperty({ type: 'object', additionalProperties: true })
    config!: Record<string, unknown>;
}

/** `GET /internal/connections/{id}/credential` (v5.2 API §3.16): one call's worth of the outbound credential. */
export class InternalConnectionCredentialDto {
    @ApiProperty()
    connectionId!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: ConnectionProvider })
    provider!: string;

    @ApiProperty({ enum: ConnectionDirection })
    direction!: string;

    @ApiProperty({ enum: ConnectionStatus })
    status!: string;

    @ApiProperty({ description: 'Decrypted outbound credentials (`api_key` and/or `oauth_code`)', type: 'object', additionalProperties: true })
    credentials!: OutboundCredentials;

    @ApiProperty({ type: 'object', additionalProperties: true })
    config!: Record<string, unknown>;
}

/** `POST /internal/connections/{id}/verified`: what Event Ingestion learns back. */
export class InternalConnectionVerifiedDto {
    @ApiProperty()
    connectionId!: string;

    @ApiProperty({ enum: ConnectionStatus })
    status!: string;
}

/** The key `/t/o` and `/t/c` tokens are signed and verified with (Architecture §2.1). */
export class TrackingTokenKeyDto {
    @ApiProperty({ description: '32 bytes as 64 hex characters' })
    key!: string;
}

// ============================================================
// Mapper
// ============================================================

/** Explicit field list: no secret or credential column is ever part of a response. */
export function toConnectionResponse(entity: ConnectionProps): ConnectionResponse {
    return Object.assign(new ConnectionResponse(), {
        id: entity.id,
        tenantId: entity.tenantId,
        provider: entity.provider,
        direction: entity.direction,
        status: entity.status,
        name: entity.name ?? null,
        ...(receivesCallbacks(entity.direction) ? { inboundUrl: receiverPath(entity.provider, entity.id) } : {}),
        config: (entity.config ?? {}) as Record<string, unknown>,
        lastVerifiedAt: entity.lastVerifiedAt ?? null,
        lastSyncAt: entity.lastSyncAt ?? null,
        previousSecretValidUntil: entity.previousSecretValidUntil ?? null,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        revokedAt: entity.revokedAt ?? null
    });
}

/** API §6.5 — the path Event Ingestion hosts, not this service. */
export const receiverPath = (provider: string, connectionId: string): string => `/inbound/${provider}/${connectionId}`;

// ============================================================
// Domain Events (v5.2 Event Model §5.11: connection.created · verified · rotated · revoked; credentials never travel)
// ============================================================

interface ConnectionFacts {
    connectionId: string;
    provider: string;
    direction: string;
    status: string;
}

export class ConnectionCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'connection.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: ConnectionFacts & { createdBy: string },
        public readonly userId?: string
    ) {
        super();
    }
}

/** The connection turned active: its first verified callback (`source: callback`) or a successful test (`test`). */
export class ConnectionVerifiedEvent extends BaseDomainEvent {
    readonly eventType = 'connection.verified' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: ConnectionFacts & { verifiedAt: Date; source: 'callback' | 'test' },
        public readonly userId?: string
    ) {
        super();
    }
}

/** `oldSecretValidUntil` is null when only the outbound credential changed (there is no old signing secret to honour). */
export class ConnectionRotatedEvent extends BaseDomainEvent {
    readonly eventType = 'connection.rotated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: ConnectionFacts & { rotatedAt: Date; oldSecretValidUntil: Date | null; rotatedBy: string },
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
        public readonly payload: ConnectionFacts & { revokedBy: string },
        public readonly userId?: string
    ) {
        super();
    }
}

/** In-process only: each `GET /internal/connections/{id}/credential` call is an audit row (v5.2 US1.5.4 AC2). */
export class ConnectionCredentialReadEvent extends BaseDomainEvent {
    readonly eventType = 'connection.credential_read' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        /** `service:{client_id}` of the caller. */
        public readonly userId: string
    ) {
        super();
    }
}

export const ConnectionEvents = {
    CREATED: 'connection.created',
    VERIFIED: 'connection.verified',
    ROTATED: 'connection.rotated',
    REVOKED: 'connection.revoked',
    CREDENTIAL_READ: 'connection.credential_read'
} as const;

/**
 * US1.5.3 F2 — the revocation marker, a contract with Event Ingestion (event-svc `ConnectionCacheService`).
 * Written by tenant-service when a connection is revoked, in the Redis both services share and outside either
 * service's key prefix, so Ingestion refuses a connection it still holds in its cache at once instead of after
 * its cache TTL (300 s by default). Revocation is permanent, so the marker only has to outlive that cache entry.
 */
export const revokedConnectionMarkerKey = (connectionId: string): string => `connection-revoked:${connectionId}`;
export const REVOKED_CONNECTION_MARKER_TTL_SECONDS = 3600;
