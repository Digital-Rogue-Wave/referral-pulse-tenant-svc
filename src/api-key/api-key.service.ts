import { Injectable } from '@nestjs/common';
import { FindOptionsRelations, FindOptionsWhere } from 'typeorm';
import { ApiKeyEntity } from './api-key.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { UpdateApiKeyStatusDto } from './dto/update-api-key-status.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiKeyStatusEnum } from '@mod/common/enums/api-key.enum';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { NullableType } from '@mod/types/nullable.type';
import { SharedService } from '@mod/common/shared.service';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { apiKeyPaginationConfig } from './config/api-key-pagination-config';

/**
 * Service responsible for API Key management
 * Follows Single Responsibility Principle - handles only API key business logic
 * Follows Dependency Inversion Principle - depends on abstractions (repositories, services)
 */
@Injectable()
export class ApiKeyService {
    constructor(
        @InjectTenantAwareRepository(ApiKeyEntity)
        private readonly apiKeyRepository: TenantAwareRepository<ApiKeyEntity>,
        private readonly eventEmitter: EventEmitter2,
        private readonly sharedService: SharedService
    ) {}

    /**
     * Generate a new API key for a tenant
     * The raw key is returned only once and never stored
     */
    async create(userId: string, createDto: CreateApiKeyDto, ipAddress?: string, userAgent?: string): Promise<ApiKeyEntity> {
        // Generate secure random key
        const rawKey = this.sharedService.generateSecureApiKey();
        const keyHash = await this.sharedService.hashApiKey(rawKey);
        const keyPrefix = this.sharedService.extractApiKeyPrefix(rawKey);

        // Create entity
        const apiKey = this.apiKeyRepository.createTenantContext({
            name: createDto.name,
            keyHash,
            keyPrefix,
            scopes: createDto.scopes,
            createdBy: userId,
            expiresAt: createDto.expiresAt || null,
            status: ApiKeyStatusEnum.ACTIVE
        });

        // Save to database
        const savedKey = await this.apiKeyRepository.saveTenantContext(apiKey);

        // Emit created event
        await this.eventEmitter.emitAsync('api-key.created', {
            apiKey: savedKey,
            userId,
            ipAddress,
            userAgent
        });

        // Return response with raw key (only time it's visible)
        return savedKey;
    }

    /**
     * List all API keys for a tenant
     */
    async findAll(query: PaginateQuery): Promise<Paginated<ApiKeyEntity>> {
        return await this.apiKeyRepository.paginateTenantContext(query, this.apiKeyRepository, apiKeyPaginationConfig);
    }

    /**
     * Get a single API key by ID
     */
    async findOne(field: FindOptionsWhere<ApiKeyEntity>, relations?: FindOptionsRelations<ApiKeyEntity>): Promise<NullableType<ApiKeyEntity>> {
        return await this.apiKeyRepository.findOneTenantContext(field, relations);
    }

    async findOneOrFail(field: FindOptionsWhere<ApiKeyEntity>): Promise<ApiKeyEntity> {
        return await this.apiKeyRepository.findOneOrFailTenantContext(field);
    }

    /**
     * Update API key metadata (name, scopes)
     */
    async update(id: string, userId: string, updateDto: UpdateApiKeyDto, ipAddress?: string, userAgent?: string): Promise<ApiKeyEntity> {
        const apiKey = await this.findOneOrFail({ id });

        // Update fields
        if (updateDto.name !== undefined) {
            apiKey.name = updateDto.name;
        }
        if (updateDto.scopes !== undefined) {
            apiKey.scopes = updateDto.scopes;
        }

        const updatedKey = await this.apiKeyRepository.saveTenantContext(apiKey);

        // Emit updated event
        await this.eventEmitter.emitAsync('api-key.updated', {
            apiKey: updatedKey,
            changes: updateDto,
            userId,
            ipAddress,
            userAgent
        });

        return updatedKey;
    }

    /**
     * Update API key status (active/stopped)
     */
    async updateStatus(id: string, userId: string, statusDto: UpdateApiKeyStatusDto, ipAddress?: string, userAgent?: string): Promise<ApiKeyEntity> {
        const apiKey = await this.findOneOrFail({ id });

        const previousStatus = apiKey.status;
        apiKey.status = statusDto.status;

        const updatedKey = await this.apiKeyRepository.saveTenantContext(apiKey);

        // Emit status updated event
        await this.eventEmitter.emitAsync('api-key.status.updated', {
            apiKey: updatedKey,
            previousStatus,
            newStatus: statusDto.status,
            userId,
            ipAddress,
            userAgent
        });

        return updatedKey;
    }

    /**
     * Delete (hard delete) an API key
     */
    async delete(id: string, userId: string, ipAddress?: string, userAgent?: string): Promise<void> {
        const apiKey = await this.findOneOrFail({ id });

        await this.apiKeyRepository.deleteTenantContext({ id });

        // Emit deleted event
        await this.eventEmitter.emitAsync('api-key.deleted', {
            apiKeyId: id,
            tenantId: apiKey.tenantId,
            keyName: apiKey.name,
            keyPrefix: apiKey.keyPrefix,
            userId,
            ipAddress,
            userAgent
        });
    }

    /**
     * Validate an API key (for authentication middleware)
     * Returns the API key entity if valid, null otherwise
     */
    async validateKey(rawKey: string): Promise<ApiKeyEntity | null> {
        const keyPrefix = this.sharedService.extractApiKeyPrefix(rawKey);

        // Find by prefix first (indexed) - use QueryBuilder to BYPASS tenant context check
        // because we don't know the tenant yet (we are authenticating!)
        const apiKey = await this.apiKeyRepository
            .createQueryBuilder('k')
            .where('k.keyPrefix = :keyPrefix', { keyPrefix })
            .andWhere('k.status = :status', { status: ApiKeyStatusEnum.ACTIVE })
            .getOne();

        // Check each key's hash
        if (apiKey) {
            const isValid = await this.sharedService.compareApiKeys(rawKey, apiKey.keyHash);
            if (isValid) {
                // Check expiration
                if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
                    return null;
                }

                // Update last used timestamp (async, don't await)
                this.updateLastUsed(apiKey.id).catch((err) => {
                    console.error('Failed to update lastUsedAt:', err);
                });

                return apiKey;
            }
        }

        return null;
    }

    /**
     * Private helper: Update last used timestamp
     */
    private async updateLastUsed(id: string): Promise<void> {
        await this.apiKeyRepository.update(id, {
            lastUsedAt: new Date()
        });
    }
}
