import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { PrivilegedDatabaseService } from '@app/database/privileged-database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import type { AllConfigType } from '@config/config.type';
import { BaseException } from '@common/exceptions/base.exceptions';
import { cursorPage, CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';

import {
    ConnectionCreatedEvent,
    ConnectionCredentialReadEvent,
    ConnectionEvents,
    ConnectionProps,
    ConnectionProvider,
    ConnectionResponse,
    ConnectionRevokedEvent,
    ConnectionRotatedEvent,
    ConnectionStatus,
    ConnectionTestResponse,
    ConnectionVerifiedEvent,
    CreateConnectionDto,
    DIRECTION_OF,
    InternalConnectionCredentialDto,
    InternalConnectionDto,
    InternalConnectionVerifiedDto,
    OutboundCredentials,
    PREVIOUS_SIGNING_SECRET_GRACE_MS,
    REVOKED_CONNECTION_MARKER_TTL_SECONDS,
    RotateConnectionDto,
    receivesCallbacks,
    revokedConnectionMarkerKey,
    toConnectionResponse
} from '@domains/connection';

import { acceptCredentials } from './connection-credentials';
import { ConnectionTester } from './connection-tester';
import { ProviderSecretCipher } from './provider-secret.cipher';

const LIVE = { not: ConnectionStatus.REVOKED } as const;

/**
 * Connections (v5.2 API §3.16): a tenant's credentialed link to a provider. The connection's id is the
 * `{connection_id}` in ingestion's `/inbound/{provider}/{connection_id}`, so the callback URL itself names the tenant
 * and the secret. Lifecycle: `pending_verification` → `active` on the first verified callback or a successful
 * outbound test → `revoked`. Credentials are sealed before they are stored and never returned to a tenant.
 */
@Injectable()
export class ConnectionService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly privileged: PrivilegedDatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly tenantAware: TenantAwareService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly cipher: ProviderSecretCipher,
        private readonly tester: ConnectionTester,
        private readonly logger: AppLoggerService,
        private readonly redis: RedisService,
        private readonly configService: ConfigService<AllConfigType>
    ) {
        this.logger.setContext(ConnectionService.name);
    }

    /** Tenant-scoped ProviderConnection delegate */
    private get connection() {
        return this.tenantAware.forModel(this.prisma.providerConnection);
    }

    async create(userId: string, dto: CreateConnectionDto): Promise<ConnectionResponse> {
        const tenantId = this.tenantAware.getRequiredTenantId();
        const direction = this.directionOf(dto);
        const credentials = acceptCredentials(dto.provider, dto.credentials, 'create');

        try {
            const created = await this.prisma.$transaction(async (tx) => {
                const row = (await tx.providerConnection.create({
                    data: {
                        tenantId,
                        provider: dto.provider,
                        direction,
                        name: dto.name ?? null,
                        signingSecretEncrypted: credentials.signingSecret ? this.cipher.encrypt(credentials.signingSecret) : null,
                        credentialsEncrypted: this.sealOutbound(credentials.outbound),
                        config: (dto.config ?? {}) as Prisma.InputJsonValue,
                        createdBy: userId
                    }
                })) as ConnectionProps;
                this.txEventEmitter.emitAfterCommit(
                    ConnectionEvents.CREATED,
                    new ConnectionCreatedEvent(row.id, tenantId, { ...facts(row), createdBy: userId }, userId)
                );
                return row;
            });
            this.logger.log('Connection created', { connectionId: created.id, provider: created.provider });
            return this.toResponse(created);
        } catch (error) {
            if (isUniqueViolation(error)) {
                // `idx_connections_live` — one live connection per tenant per provider, so a second one cannot quietly
                // take over the callbacks of the first.
                throw new BaseException(
                    'state_conflict',
                    `A live ${dto.provider} connection already exists; revoke it before creating another`,
                    HttpStatus.CONFLICT
                );
            }
            throw error;
        }
    }

    async findAll(query: ListQueryDto): Promise<CursorPage<ConnectionResponse>> {
        return cursorPage(this.connection, {}, query, (row) => this.toResponse(row as ConnectionProps));
    }

    async findOne(id: string): Promise<ConnectionResponse> {
        const row = (await this.connection.findFirst({ where: { id } })) as ConnectionProps | null;
        if (!row) {
            throw notFound(id);
        }
        return this.toResponse(row);
    }

    /**
     * Replaces credentials. A new signing secret keeps the old one honoured for 24 hours (v5.2 API §3.16), so the
     * provider's console can be updated without dropping callbacks; an outbound credential is replaced outright.
     */
    async rotate(id: string, userId: string, dto: RotateConnectionDto): Promise<ConnectionResponse> {
        const existing = await this.findLive(id);
        const credentials = acceptCredentials(existing.provider as ConnectionProvider, dto.credentials, 'rotate');
        const rotatedAt = new Date();
        const oldSecretValidUntil = credentials.signingSecret ? new Date(rotatedAt.getTime() + PREVIOUS_SIGNING_SECRET_GRACE_MS) : null;

        const rotated = await this.prisma.$transaction(async (tx) => {
            const row = (await tx.providerConnection.update({
                where: { id },
                data: {
                    ...(credentials.signingSecret
                        ? {
                              signingSecretEncrypted: this.cipher.encrypt(credentials.signingSecret),
                              previousSigningSecretEncrypted: existing.signingSecretEncrypted ?? null,
                              previousSecretValidUntil: existing.signingSecretEncrypted ? oldSecretValidUntil : null
                          }
                        : {}),
                    ...(credentials.outbound ? { credentialsEncrypted: this.sealOutbound(credentials.outbound) } : {})
                }
            })) as ConnectionProps;
            this.txEventEmitter.emitAfterCommit(
                ConnectionEvents.ROTATED,
                new ConnectionRotatedEvent(
                    id,
                    existing.tenantId,
                    { ...facts(row), rotatedAt, oldSecretValidUntil: row.previousSecretValidUntil ?? null, rotatedBy: userId },
                    userId
                )
            );
            return row;
        });
        this.logger.log('Connection rotated', { connectionId: id, signingSecret: !!credentials.signingSecret, outbound: !!credentials.outbound });
        return this.toResponse(rotated);
    }

    /** The outbound connectivity check; success activates a pending connection. Inbound-only ones activate on a callback. */
    async test(id: string, userId: string): Promise<ConnectionTestResponse> {
        const existing = await this.findLive(id);
        if (existing.direction === 'inbound') {
            throw new BaseException(
                'state_conflict',
                'An inbound connection has no outbound check; it turns active on its first verified callback',
                HttpStatus.CONFLICT
            );
        }
        const failure = await this.tester.check(existing.provider as ConnectionProvider, this.openOutbound(existing), configOf(existing));
        const status = failure ? existing.status : await this.activate(existing, 'test', userId);
        this.logger.log('Connection tested', { connectionId: id, ok: !failure, failure });
        return { connectionId: id, ok: !failure, failure, status, checkedAt: new Date() };
    }

    /** Revokes a connection: its callbacks stop being accepted, its outbound use stops, its slot is freed. */
    async revoke(id: string, userId: string): Promise<void> {
        const existing = await this.findLive(id);
        await this.prisma.$transaction(async (tx) => {
            const row = (await tx.providerConnection.update({
                where: { id },
                data: { status: ConnectionStatus.REVOKED, revokedAt: new Date() }
            })) as ConnectionProps;
            this.txEventEmitter.emitAfterCommit(
                ConnectionEvents.REVOKED,
                new ConnectionRevokedEvent(id, existing.tenantId, { ...facts(row), revokedBy: userId }, userId)
            );
        });
        await this.markRevoked(id);
        this.logger.log('Connection revoked', { connectionId: id, provider: existing.provider });
    }

    /**
     * What Event Ingestion caches to verify a callback: the inbound signing secret, and the previous one while its
     * 24 hours last — never an outbound credential. Cross-tenant by design: the path's connection id resolves the
     * tenant. Null (the receiver's 404) for an unknown or revoked connection, or one that receives no callbacks.
     */
    async findForReceiver(provider: ConnectionProvider, connectionId: string): Promise<InternalConnectionDto | null> {
        // Privileged read: the connection id is what tells us the tenant (v5.2 DB Model §0.8).
        const row = (await this.privileged.providerConnection.findFirst({
            where: { id: connectionId, provider, status: LIVE }
        })) as ConnectionProps | null;
        if (!row || !receivesCallbacks(row.direction)) {
            return null;
        }
        const previousValid = !!row.previousSigningSecretEncrypted && !!row.previousSecretValidUntil && row.previousSecretValidUntil > new Date();
        return {
            connectionId: row.id,
            tenantId: row.tenantId,
            provider: row.provider,
            direction: row.direction,
            status: row.status,
            signingSecret: row.signingSecretEncrypted ? this.cipher.decrypt(row.signingSecretEncrypted) : null,
            previousSigningSecret: previousValid ? this.cipher.decrypt(row.previousSigningSecretEncrypted!) : null,
            previousSecretValidUntil: previousValid ? row.previousSecretValidUntil! : null,
            config: configOf(row)
        };
    }

    /** Event Ingestion's report of a connection's first verified callback (v5.2 US1.5.2 AC1). Idempotent. */
    async markVerifiedByCallback(connectionId: string, clientId: string): Promise<InternalConnectionVerifiedDto | null> {
        const row = await this.liveById(connectionId);
        if (!row) {
            return null;
        }
        const status = await this.inTenantOf(row, () => this.activate(row, 'callback', `service:${clientId}`));
        return { connectionId, status };
    }

    /**
     * `GET /internal/connections/{id}/credential` (v5.2 API §3.16): the outbound credential for one provider call by
     * reward- or notification-service. The audit row is written in the same transaction, so no credential leaves
     * without one (US1.5.4 AC2).
     */
    async credentialFor(connectionId: string, clientId: string): Promise<InternalConnectionCredentialDto | null> {
        const found = await this.liveById(connectionId);
        if (!found) {
            return null;
        }
        return this.inTenantOf(found, () =>
            this.prisma.$transaction(async (tx) => {
                const row = (await tx.providerConnection.findFirst({ where: { id: connectionId, status: LIVE } })) as ConnectionProps | null;
                if (!row) {
                    return null;
                }
                this.txEventEmitter.emitAfterCommit(
                    ConnectionEvents.CREDENTIAL_READ,
                    new ConnectionCredentialReadEvent(row.id, row.tenantId, `service:${clientId}`)
                );
                return { ...facts(row), tenantId: row.tenantId, credentials: this.openOutbound(row), config: configOf(row) };
            })
        );
    }

    /** A service caller names a connection by id only: the privileged read finds it, and with it the tenant (§0.8). */
    private async liveById(connectionId: string): Promise<ConnectionProps | null> {
        return (await this.privileged.providerConnection.findFirst({ where: { id: connectionId, status: LIVE } })) as ConnectionProps | null;
    }

    /** The write that follows runs as that tenant, so row-level security still binds it. */
    private inTenantOf<T>(row: ConnectionProps, work: () => Promise<T>): Promise<T> {
        return this.tenantContext.runWithContext({ tenantId: row.tenantId }, work);
    }

    /** Pending → active, once: the conditional update makes concurrent callbacks emit `connection.verified` a single time. */
    private async activate(row: ConnectionProps, source: 'callback' | 'test', actor: string): Promise<string> {
        const verifiedAt = new Date();
        return this.prisma.$transaction(async (tx) => {
            const { count } = await tx.providerConnection.updateMany({
                where: { id: row.id, status: ConnectionStatus.PENDING_VERIFICATION },
                data: { status: ConnectionStatus.ACTIVE, lastVerifiedAt: verifiedAt }
            });
            if (count === 0) {
                await tx.providerConnection.updateMany({
                    where: { id: row.id, status: ConnectionStatus.ACTIVE },
                    data: { lastVerifiedAt: verifiedAt }
                });
                return row.status;
            }
            this.txEventEmitter.emitAfterCommit(
                ConnectionEvents.VERIFIED,
                new ConnectionVerifiedEvent(
                    row.id,
                    row.tenantId,
                    { ...facts({ ...row, status: ConnectionStatus.ACTIVE }), verifiedAt, source },
                    actor
                )
            );
            return ConnectionStatus.ACTIVE;
        });
    }

    /** The provider matrix fixes the direction (v5.2 US1.5.1 AC3); a client that sends another one is told so. */
    private directionOf(dto: CreateConnectionDto): string {
        const fixed = DIRECTION_OF[dto.provider];
        if (dto.direction && dto.direction !== fixed) {
            throw new BaseException(
                'invalid_request',
                `A ${dto.provider} connection is ${fixed}, not ${dto.direction}`,
                HttpStatus.BAD_REQUEST,
                'direction'
            );
        }
        return fixed;
    }

    private sealOutbound(outbound: OutboundCredentials | undefined): string | null {
        return outbound ? this.cipher.encrypt(JSON.stringify(outbound)) : null;
    }

    private openOutbound(row: ConnectionProps): OutboundCredentials {
        return row.credentialsEncrypted ? (JSON.parse(this.cipher.decrypt(row.credentialsEncrypted)) as OutboundCredentials) : {};
    }

    /** US1.5.1 F4: the inbound URL is absolute when the public base URL is configured, so it can be pasted as is. */
    private toResponse(row: ConnectionProps): ConnectionResponse {
        const response = toConnectionResponse(row);
        const base = this.configService.get('connectionConfig.inboundPublicBaseUrl', { infer: true });
        return base && response.inboundUrl ? { ...response, inboundUrl: `${base.replace(/\/+$/, '')}${response.inboundUrl}` } : response;
    }

    /**
     * US1.5.3 F2: tells Event Ingestion at once, through the shared Redis, so a connection it still caches is
     * refused now rather than when `connection.revoked` reaches it or its cache expires. Best effort: the revoke is
     * committed, and the event still drops the cache entry if this write fails.
     */
    private async markRevoked(id: string): Promise<void> {
        try {
            await this.redis.getClient().set(revokedConnectionMarkerKey(id), '1', 'EX', REVOKED_CONNECTION_MARKER_TTL_SECONDS);
        } catch (error) {
            this.logger.warn('Could not mark the connection revoked for Event Ingestion; its cache drops it on connection.revoked', {
                connectionId: id,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async findLive(id: string): Promise<ConnectionProps> {
        const row = (await this.connection.findFirst({ where: { id, status: LIVE } })) as ConnectionProps | null;
        if (!row) {
            throw notFound(id);
        }
        return row;
    }
}

const facts = (row: ConnectionProps) => ({ connectionId: row.id, provider: row.provider, direction: row.direction, status: row.status });

const configOf = (row: ConnectionProps): Record<string, unknown> => (row.config ?? {}) as Record<string, unknown>;

const notFound = (id: string): BaseException => new BaseException('not_found', `Connection not found: ${id}`, HttpStatus.NOT_FOUND);

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
