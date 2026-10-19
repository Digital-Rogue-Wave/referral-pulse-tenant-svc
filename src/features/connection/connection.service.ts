import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { cursorPage, CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';

import {
    ConnectionCreatedEvent,
    ConnectionEvents,
    ConnectionProps,
    ConnectionProvider,
    ConnectionResponse,
    ConnectionRevokedEvent,
    CreateConnectionDto,
    InternalConnectionDto,
    connectionResponseMapper
} from '@domains/connection';

import { ProviderSecretCipher } from './provider-secret.cipher';

/**
 * Provider connections — the billing, payout and CRM integrations whose callbacks Event Ingestion
 * verifies (Architecture v5 §2.1: this service owns "provider connection config and secrets … webhook
 * signing secrets", exposed to Event Ingestion through a cache).
 *
 * The connection's id is the `{connection_id}` in ingestion's `/inbound/{provider}/{connection_id}`, so
 * the callback URL itself names the tenant and the secret. Nothing a caller asserts in the body selects
 * either one.
 */
@Injectable()
export class ConnectionService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly cipher: ProviderSecretCipher,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(ConnectionService.name);
    }

    /** Tenant-scoped ProviderConnection delegate */
    private get connection() {
        return this.tenantAware.forModel(this.prisma.providerConnection);
    }

    /**
     * Creates a connection and returns its receiver URL. The secret is encrypted before it is stored and
     * is never read back by any tenant-facing endpoint — rotating means creating a new connection, which
     * is also what gives the provider a new URL to post to.
     */
    async create(userId: string, dto: CreateConnectionDto): Promise<ConnectionResponse> {
        const tenantId = this.tenantAware.getRequiredTenantId();
        const signingSecret = this.cipher.encrypt(dto.signingSecret);

        try {
            const created = await this.prisma.$transaction(async (tx) => {
                const row = (await tx.providerConnection.create({
                    data: {
                        tenantId,
                        provider: dto.provider,
                        connectionType: dto.connectionType,
                        name: dto.name ?? null,
                        signingSecret,
                        config: (dto.config ?? {}) as Prisma.InputJsonValue,
                        createdBy: userId
                    }
                })) as ConnectionProps;
                this.txEventEmitter.emitAfterCommit(
                    ConnectionEvents.CREATED,
                    new ConnectionCreatedEvent(
                        row.id,
                        tenantId,
                        { connectionId: row.id, provider: row.provider, connectionType: row.connectionType, createdBy: userId },
                        userId
                    )
                );
                return row;
            });
            this.logger.log('Provider connection created', { connectionId: created.id, provider: created.provider });
            return connectionResponseMapper.toResponse(created);
        } catch (error) {
            if (isUniqueViolation(error)) {
                // `idx_provider_conn_live` — one live connection per tenant per provider, so a second one
                // cannot quietly take over the callbacks of the first.
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
        return cursorPage(this.connection, {}, query, (row) => connectionResponseMapper.toResponse(row as ConnectionProps));
    }

    /**
     * Revokes a connection: its callbacks stop being accepted and its slot is freed for a replacement.
     * Soft delete, because the receipts a provider already sent must stay attributable to it.
     */
    async revoke(id: string, userId: string): Promise<void> {
        const existing = await this.findLive(id);
        await this.prisma.$transaction(async (tx) => {
            await tx.providerConnection.update({ where: { id }, data: { enabled: false, revokedAt: new Date() } });
            this.txEventEmitter.emitAfterCommit(
                ConnectionEvents.REVOKED,
                new ConnectionRevokedEvent(id, existing.tenantId, { connectionId: id, provider: existing.provider, revokedBy: userId }, userId)
            );
        });
        this.logger.log('Provider connection revoked', { connectionId: id, provider: existing.provider });
    }

    /**
     * What Event Ingestion caches to verify a callback. Cross-tenant by design: the caller is a service
     * token, and the path's connection id is what resolves the tenant — ingestion has no tenant context
     * of its own when a provider posts to it.
     *
     * Returns null for an unknown, revoked or disabled connection, which is the 404 the receiver owes
     * the provider (API Contract §6.5).
     */
    async findForReceiver(provider: ConnectionProvider, connectionId: string): Promise<InternalConnectionDto | null> {
        const row = await this.prisma.providerConnection.findFirst({
            where: { id: connectionId, provider, enabled: true, revokedAt: null }
        });
        if (!row) {
            return null;
        }
        return {
            connectionId: row.id,
            tenantId: row.tenantId,
            provider: row.provider,
            connectionType: row.connectionType,
            signingSecret: row.signingSecret ? this.cipher.decrypt(row.signingSecret) : null,
            config: (row.config ?? {}) as Record<string, unknown>,
            enabled: row.enabled
        };
    }

    private async findLive(id: string): Promise<ConnectionProps> {
        const row = (await this.connection.findFirst({ where: { id, revokedAt: null } })) as ConnectionProps | null;
        if (!row) {
            throw new BaseException('not_found', `Connection not found: ${id}`, HttpStatus.NOT_FOUND);
        }
        return row;
    }
}

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
