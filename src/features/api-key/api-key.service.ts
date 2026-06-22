import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { prismaPaginate, PaginateQuery, Paginated } from '@common/nestjs-prisma-pagination';

import {
    ApiKeyProps,
    CreateApiKeyDto,
    UpdateApiKeyDto,
    ApiKeyResponse,
    ApiKeyWithRawKeyResponse,
    apiKeyResponseMapper,
    ApiKeyCreatedEvent,
    ApiKeyUpdatedEvent,
    ApiKeyDeletedEvent,
    ApiKeyType
} from '@domains/api-key';

import { API_KEY_PAGINATE_CONFIG } from './api-key.pagination';

/**
 * Service responsible for API Key management
 * Uses Prisma with TenantAwareService for multi-tenant data access
 */
@Injectable()
export class ApiKeyService {
    /** bcrypt cost factor for hashing raw API keys at rest (key_hash, db_tables §api_keys). */
    private readonly BCRYPT_ROUNDS = 12;

    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly tenantContext: TenantContextService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(ApiKeyService.name);
    }

    /** Tenant-scoped ApiKey delegate */
    private get apiKey() {
        return this.tenantAware.forModel(this.prisma.apiKey);
    }

    /**
     * Generate a new API key for a tenant
     * The raw key is returned only once and never stored
     */
    async create(userId: string, dto: CreateApiKeyDto): Promise<ApiKeyWithRawKeyResponse> {
        const keyType = dto.keyType ?? ApiKeyType.SECRET;
        const rawKey = this.generateSecureApiKey(keyType);
        const keyHash = await this.hashApiKey(rawKey);
        const keyPrefix = this.extractApiKeyPrefix(rawKey);

        const saved = (await this.apiKey.create({
            data: {
                label: dto.label,
                keyHash,
                keyPrefix,
                keyType,
                scopes: dto.scopes,
                createdBy: userId,
                expiresAt: dto.expiresAt ?? null
            }
        })) as ApiKeyProps;

        // Emit domain event + audit event after commit
        const event = new ApiKeyCreatedEvent(
            saved.id,
            saved.tenantId,
            {
                apiKeyId: saved.id,
                tenantId: saved.tenantId,
                label: saved.label,
                keyPrefix: saved.keyPrefix,
                keyType: saved.keyType,
                scopes: saved.scopes as string[],
                createdBy: userId,
                createdAt: saved.createdAt
            },
            userId
        );
        this.txEventEmitter.emitAfterCommit('api-key.created', event);
        this.txEventEmitter.emitAfterCommit('audit.api-key.created', event);

        this.logger.log(`API key created: ${saved.id}`, {
            apiKeyId: saved.id,
            label: saved.label
        });

        return apiKeyResponseMapper.toResponseWithRawKey(saved, rawKey);
    }

    /**
     * List all API keys for a tenant with pagination
     */
    async findAll(query: PaginateQuery): Promise<Paginated<ApiKeyResponse>> {
        const baseWhere = this.tenantAware.withTenantFilter({ deletedAt: null });
        const result = await prismaPaginate(query, this.prisma.apiKey, API_KEY_PAGINATE_CONFIG, baseWhere);

        return {
            data: apiKeyResponseMapper.toResponseArray(result.data as ApiKeyProps[]),
            meta: result.meta as Paginated<ApiKeyResponse>['meta'],
            links: result.links
        };
    }

    /**
     * Get a single API key by ID
     */
    async findById(id: string): Promise<ApiKeyResponse> {
        const apiKey = (await this.apiKey.findUnique({
            where: { id }
        })) as ApiKeyProps | null;

        if (!apiKey) {
            throw new NotFoundException(`API key with ID ${id} not found`);
        }

        return apiKeyResponseMapper.toResponse(apiKey);
    }

    /**
     * Update API key metadata (name, scopes)
     */
    async update(id: string, userId: string, dto: UpdateApiKeyDto): Promise<ApiKeyResponse> {
        const existing = await this.apiKey.findUnique({ where: { id } });
        if (!existing) {
            throw new NotFoundException(`API key with ID ${id} not found`);
        }

        const updated = (await this.apiKey.update({
            where: { id },
            data: dto
        })) as ApiKeyProps;

        // Build changes object
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (dto.label && dto.label !== existing.label) {
            changes.label = { from: existing.label, to: dto.label };
        }
        if (dto.scopes) {
            changes.scopes = { from: existing.scopes, to: dto.scopes };
        }

        if (Object.keys(changes).length > 0) {
            const event = new ApiKeyUpdatedEvent(
                id,
                updated.tenantId,
                {
                    apiKeyId: id,
                    tenantId: updated.tenantId,
                    changes,
                    updatedBy: userId,
                    updatedAt: updated.updatedAt
                },
                userId
            );
            this.txEventEmitter.emitAfterCommit('api-key.updated', event);
            this.txEventEmitter.emitAfterCommit('audit.api-key.updated', event);
        }

        this.logger.log(`API key updated: ${id}`, { apiKeyId: id, changes });

        return apiKeyResponseMapper.toResponse(updated);
    }

    /**
     * Rotate an API key (api-key lifecycle — system_architecture §tenant-service).
     * Issues a fresh secret for the same key id/label/scopes, invalidating the old secret immediately.
     * The new raw key is returned exactly once.
     */
    async rotate(id: string, userId: string): Promise<ApiKeyWithRawKeyResponse> {
        const existing = (await this.apiKey.findUnique({ where: { id } })) as ApiKeyProps | null;
        if (!existing) {
            throw new NotFoundException(`API key with ID ${id} not found`);
        }
        if (existing.revokedAt) {
            throw new BadRequestException('Cannot rotate a revoked API key');
        }

        const rawKey = this.generateSecureApiKey(existing.keyType as ApiKeyType);
        const keyHash = await this.hashApiKey(rawKey);
        const keyPrefix = this.extractApiKeyPrefix(rawKey);

        const updated = (await this.apiKey.update({
            where: { id },
            data: { keyHash, keyPrefix, lastUsedAt: null }
        })) as ApiKeyProps;

        const event = new ApiKeyUpdatedEvent(
            id,
            updated.tenantId,
            {
                apiKeyId: id,
                tenantId: updated.tenantId,
                changes: { keyPrefix: { from: existing.keyPrefix, to: keyPrefix } },
                updatedBy: userId,
                updatedAt: updated.updatedAt
            },
            userId
        );
        this.txEventEmitter.emitAfterCommit('api-key.updated', event);
        this.txEventEmitter.emitAfterCommit('audit.api-key.updated', event);

        this.logger.log(`API key rotated: ${id}`, { apiKeyId: id });

        return apiKeyResponseMapper.toResponseWithRawKey(updated, rawKey);
    }

    /**
     * Revoke an API key (immediate, irreversible per api_contract §2.2).
     * Sets revoked_at and soft-deletes the record.
     */
    async delete(id: string, userId: string): Promise<void> {
        const existing = (await this.apiKey.findUnique({
            where: { id }
        })) as ApiKeyProps | null;
        if (!existing) {
            throw new NotFoundException(`API key with ID ${id} not found`);
        }

        const revokedAt = new Date();
        await this.apiKey.update({ where: { id }, data: { revokedAt } });
        await this.apiKey.delete({ where: { id } });

        const event = new ApiKeyDeletedEvent(
            id,
            existing.tenantId,
            {
                apiKeyId: id,
                tenantId: existing.tenantId,
                keyLabel: existing.label,
                keyPrefix: existing.keyPrefix,
                deletedBy: userId,
                deletedAt: revokedAt
            },
            userId
        );
        this.txEventEmitter.emitAfterCommit('api-key.deleted', event);
        this.txEventEmitter.emitAfterCommit('audit.api-key.deleted', event);

        this.logger.log(`API key deleted: ${id}`, { apiKeyId: id });
    }

    /**
     * Validate an API key (for authentication middleware)
     * Returns the API key entity if valid, null otherwise
     * Note: This bypasses tenant context since we don't know the tenant yet
     */
    async validateKey(rawKey: string): Promise<ApiKeyProps | null> {
        const keyPrefix = this.extractApiKeyPrefix(rawKey);

        // bcrypt hashes are salted, so we narrow by the (non-unique) last-4 prefix and
        // bcrypt.compare each candidate. Query directly without tenant context (we're authenticating).
        const candidates = (await this.prisma.apiKey.findMany({
            where: {
                keyPrefix,
                revokedAt: null,
                deletedAt: null
            }
        })) as ApiKeyProps[];

        const apiKey = await this.findMatchingKey(rawKey, candidates);
        if (!apiKey) {
            return null;
        }

        // Check expiration
        if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
            throw new UnauthorizedException('The API key has expired');
        }

        // Update last used timestamp asynchronously
        this.updateLastUsed(apiKey.id).catch((error) => {
            this.logger.error(`Failed to update API key last used timestamp: ${error.message}`);
        });

        return apiKey;
    }

    /** Find the candidate whose bcrypt hash matches the raw key. */
    private async findMatchingKey(rawKey: string, candidates: ApiKeyProps[]): Promise<ApiKeyProps | null> {
        for (const candidate of candidates) {
            const isMatch = await this.compareApiKeys(rawKey, candidate.keyHash);
            if (isMatch) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Update last used timestamp (fire and forget)
     */
    private async updateLastUsed(id: string): Promise<void> {
        await this.prisma.apiKey.update({
            where: { id },
            data: { lastUsedAt: new Date() }
        });
    }

    // ============================================================================
    // Crypto helpers
    // ============================================================================

    private generateSecureApiKey(keyType: ApiKeyType): string {
        // Prefix encodes the key type per referralai_api_contract §2.2 (the gateway routes on it).
        const prefix = keyType === ApiKeyType.PUBLISHABLE ? 'rai_pub_' : 'rai_live_';
        const randomPart = randomBytes(32).toString('base64url');
        return `${prefix}${randomPart}`;
    }

    private hashApiKey(rawKey: string): Promise<string> {
        return bcrypt.hash(rawKey, this.BCRYPT_ROUNDS);
    }

    /** Last 4 chars of the raw key — display identifier and validation lookup narrowing (db_tables §api_keys). */
    private extractApiKeyPrefix(rawKey: string): string {
        return rawKey.slice(-4);
    }

    private compareApiKeys(rawKey: string, storedHash: string): Promise<boolean> {
        return bcrypt.compare(rawKey, storedHash);
    }
}
