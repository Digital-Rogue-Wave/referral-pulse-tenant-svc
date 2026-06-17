import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { prismaPaginate, PaginateQuery, Paginated } from '@common/nestjs-prisma-pagination';

import {
    ApiKeyProps,
    ApiKeyStatus,
    CreateApiKeyDto,
    UpdateApiKeyDto,
    ApiKeyResponse,
    ApiKeyWithRawKeyResponse,
    apiKeyResponseMapper,
    ApiKeyCreatedEvent,
    ApiKeyUpdatedEvent,
    ApiKeyStatusUpdatedEvent,
    ApiKeyDeletedEvent
} from '@domains/api-key';

import { API_KEY_PAGINATE_CONFIG } from './api-key.pagination';

/**
 * Service responsible for API Key management
 * Uses Prisma with TenantAwareService for multi-tenant data access
 */
@Injectable()
export class ApiKeyService {
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
        const rawKey = this.generateSecureApiKey();
        const keyHash = this.hashApiKey(rawKey);
        const keyPrefix = this.extractApiKeyPrefix(rawKey);

        const saved = (await this.apiKey.create({
            data: {
                name: dto.name,
                keyHash,
                keyPrefix,
                scopes: dto.scopes,
                createdBy: userId,
                expiresAt: dto.expiresAt,
                status: ApiKeyStatus.ACTIVE
            }
        })) as ApiKeyProps;

        // Emit domain event + audit event after commit
        const event = new ApiKeyCreatedEvent(
            saved.id,
            saved.tenantId,
            {
                apiKeyId: saved.id,
                tenantId: saved.tenantId,
                name: saved.name,
                keyPrefix: saved.keyPrefix,
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
            name: saved.name
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
        if (dto.name && dto.name !== existing.name) {
            changes.name = { from: existing.name, to: dto.name };
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
     * Update API key status (active/stopped)
     */
    async updateStatus(id: string, userId: string, newStatus: string): Promise<ApiKeyResponse> {
        const existing = (await this.apiKey.findUnique({
            where: { id }
        })) as ApiKeyProps | null;
        if (!existing) {
            throw new NotFoundException(`API key with ID ${id} not found`);
        }

        const previousStatus = existing.status;

        const updated = (await this.apiKey.update({
            where: { id },
            data: { status: newStatus }
        })) as ApiKeyProps;

        const event = new ApiKeyStatusUpdatedEvent(
            id,
            updated.tenantId,
            {
                apiKeyId: id,
                tenantId: updated.tenantId,
                previousStatus,
                newStatus,
                updatedBy: userId,
                updatedAt: updated.updatedAt
            },
            userId
        );
        this.txEventEmitter.emitAfterCommit('api-key.status', event);
        this.txEventEmitter.emitAfterCommit('audit.api-key.status', event);

        this.logger.log(`API key status updated: ${id}`, {
            apiKeyId: id,
            previousStatus,
            newStatus
        });

        return apiKeyResponseMapper.toResponse(updated);
    }

    /**
     * Soft delete an API key
     */
    async delete(id: string, userId: string): Promise<void> {
        const existing = (await this.apiKey.findUnique({
            where: { id }
        })) as ApiKeyProps | null;
        if (!existing) {
            throw new NotFoundException(`API key with ID ${id} not found`);
        }

        await this.apiKey.delete({ where: { id } });

        const event = new ApiKeyDeletedEvent(
            id,
            existing.tenantId,
            {
                apiKeyId: id,
                tenantId: existing.tenantId,
                keyName: existing.name,
                keyPrefix: existing.keyPrefix,
                deletedBy: userId,
                deletedAt: new Date()
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

        // Query directly without tenant context (we're authenticating)
        const apiKey = (await this.prisma.apiKey.findFirst({
            where: {
                keyPrefix,
                status: ApiKeyStatus.ACTIVE,
                deletedAt: null
            }
        })) as ApiKeyProps | null;

        if (!apiKey) {
            return null;
        }

        // Verify the key hash
        const isValid = this.compareApiKeys(rawKey, apiKey.keyHash);
        if (!isValid) {
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

    private generateSecureApiKey(): string {
        const prefix = 'sk_live_';
        const randomPart = randomBytes(32).toString('base64url');
        return `${prefix}${randomPart}`;
    }

    private hashApiKey(rawKey: string): string {
        return createHash('sha256').update(rawKey).digest('hex');
    }

    private extractApiKeyPrefix(rawKey: string): string {
        return rawKey.substring(0, 20);
    }

    private compareApiKeys(rawKey: string, storedHash: string): boolean {
        const inputHash = this.hashApiKey(rawKey);
        const inputBuffer = Buffer.from(inputHash, 'hex');
        const storedBuffer = Buffer.from(storedHash, 'hex');

        if (inputBuffer.length !== storedBuffer.length) {
            return false;
        }

        return timingSafeEqual(inputBuffer, storedBuffer);
    }
}
