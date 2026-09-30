import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma-gen/generated/client';
import { createHmac, randomBytes } from 'crypto';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { RedisService } from '@common/redis/redis.service';
import { cursorPage, CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';

import type { AllConfigType } from '@config/config.type';

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
    ApiKeyRotatedEvent,
    ApiKeyType
} from '@domains/api-key';
import { PlanLimitService } from '@app/features/billing/plan-limit.service';

/** DB Model v2 §3 Redis `apikey:{key_prefix}:{key_hash8}` — 300 s, dropped on revoke and rotate. */
const KEY_CACHE_TTL_SECONDS = 300;
/** `last_used_at` is written at most this often per key, instead of on every request. */
const LAST_USED_WRITE_INTERVAL_SECONDS = 60;
/** A new key's 4-char display suffix must be unique in the tenant; a clash is regenerated. */
const MAX_GENERATION_ATTEMPTS = 5;

/** What the gateway needs to know about a presented key. */
export interface ResolvedApiKey {
    id: string;
    tenantId: string;
    keyType: string;
}

/**
 * API keys for ingestion and the SDK (API Contract v1.3 §2 — keys never reach configuration endpoints).
 *
 * The stored hash is HMAC-SHA256 with a server-side pepper: a 256-bit random key needs no slow hash,
 * and a deterministic hash makes validation a single indexed lookup with a cache that revocation can
 * clear. The raw key is returned once, at creation or rotation, and never stored.
 */
@Injectable()
export class ApiKeyService {
    private readonly pepper: string;

    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly redis: RedisService,
        private readonly logger: AppLoggerService,
        private readonly planLimits: PlanLimitService,
        configService: ConfigService<AllConfigType>
    ) {
        this.logger.setContext(ApiKeyService.name);
        this.pepper = configService.getOrThrow('tokenIssuer.apiKeyHashPepper', { infer: true });
    }

    /** Tenant-scoped ApiKey delegate */
    private get apiKey() {
        return this.tenantAware.forModel(this.prisma.apiKey);
    }

    /** Issues a new key; the raw key is in the response and nowhere else. */
    async create(userId: string, dto: CreateApiKeyDto): Promise<ApiKeyWithRawKeyResponse> {
        const keyType = dto.keyType ?? ApiKeyType.SECRET;
        const tenantId = this.tenantAware.getRequiredTenantId();
        const liveKeys = await this.prisma.apiKey.count({ where: { tenantId, revokedAt: null, deletedAt: null } });
        await this.planLimits.assertCapacity(tenantId, 'api_keys', liveKeys);
        // The key row and its `api_key.created` outbox row commit together.
        const { saved, rawKey } = await this.withFreshKey(keyType, (secret) =>
            this.prisma.$transaction(async (tx) => {
                const created = (await tx.apiKey.create({
                    data: { tenantId, label: dto.label, ...secret, keyType, createdBy: userId, expiresAt: dto.expiresAt ?? null }
                })) as ApiKeyProps;
                this.txEventEmitter.emitAfterCommit(
                    'api-key.created',
                    new ApiKeyCreatedEvent(
                        created.id,
                        created.tenantId,
                        {
                            apiKeyId: created.id,
                            tenantId: created.tenantId,
                            label: created.label,
                            keyPrefix: created.keyPrefix,
                            keyType: created.keyType,
                            createdBy: userId,
                            createdAt: created.createdAt
                        },
                        userId
                    )
                );
                return created;
            })
        );

        this.logger.log('API key created', { apiKeyId: saved.id, keyType });
        return apiKeyResponseMapper.toResponseWithRawKey(saved, rawKey);
    }

    async findAll(query: ListQueryDto): Promise<CursorPage<ApiKeyResponse>> {
        return cursorPage(this.prisma.apiKey, this.tenantAware.withTenantFilter({ deletedAt: null }), query, (row) =>
            apiKeyResponseMapper.toResponse(row as ApiKeyProps)
        );
    }

    async findById(id: string): Promise<ApiKeyResponse> {
        return apiKeyResponseMapper.toResponse(await this.findLive(id));
    }

    /** Renames a key. */
    async update(id: string, userId: string, dto: UpdateApiKeyDto): Promise<ApiKeyResponse> {
        const existing = await this.findLive(id);
        const updated = (await this.apiKey.update({ where: { id }, data: { label: dto.label } })) as ApiKeyProps;

        if (dto.label && dto.label !== existing.label) {
            const event = new ApiKeyUpdatedEvent(
                id,
                updated.tenantId,
                {
                    apiKeyId: id,
                    tenantId: updated.tenantId,
                    changes: { label: { from: existing.label, to: dto.label } },
                    updatedBy: userId,
                    updatedAt: updated.updatedAt
                },
                userId
            );
            this.txEventEmitter.emitAfterCommit('api-key.updated', event);
        }
        return apiKeyResponseMapper.toResponse(updated);
    }

    /**
     * Replaces the key's secret (same id, label and type). The old secret stops working immediately —
     * its cache entry is dropped — and `api_key.rotated` tells downstream caches to drop it too.
     */
    async rotate(id: string, userId: string): Promise<ApiKeyWithRawKeyResponse> {
        const existing = await this.findLive(id);
        if (existing.revokedAt) {
            throw new BaseException('state_conflict', 'A revoked API key cannot be rotated', HttpStatus.CONFLICT);
        }

        const { saved, rawKey } = await this.withFreshKey(existing.keyType as ApiKeyType, (secret) =>
            this.prisma.$transaction(async (tx) => {
                const rotated = (await tx.apiKey.update({ where: { id }, data: { ...secret, lastUsedAt: null } })) as ApiKeyProps;
                this.txEventEmitter.emitAfterCommit(
                    'api-key.rotated',
                    new ApiKeyRotatedEvent(
                        id,
                        rotated.tenantId,
                        {
                            apiKeyId: id,
                            keyType: rotated.keyType,
                            oldKeyPrefix: existing.keyPrefix,
                            newKeyPrefix: rotated.keyPrefix,
                            rotatedBy: userId
                        },
                        userId
                    )
                );
                return rotated;
            })
        );
        await this.forget(existing);
        this.logger.log('API key rotated', { apiKeyId: id });
        return apiKeyResponseMapper.toResponseWithRawKey(saved, rawKey);
    }

    /** Revokes a key — immediate and irreversible (API §2); the reason travels on `api_key.revoked`. */
    async delete(id: string, userId: string, reason?: string): Promise<void> {
        const existing = await this.findLive(id);
        const revokedAt = new Date();
        await this.prisma.$transaction(async (tx) => {
            await tx.apiKey.update({ where: { id }, data: { revokedAt, deletedAt: revokedAt } });
            this.txEventEmitter.emitAfterCommit(
                'api-key.deleted',
                new ApiKeyDeletedEvent(
                    id,
                    existing.tenantId,
                    {
                        apiKeyId: id,
                        tenantId: existing.tenantId,
                        keyLabel: existing.label,
                        keyPrefix: existing.keyPrefix,
                        deletedBy: userId,
                        deletedAt: revokedAt,
                        reason: reason ?? null
                    },
                    userId
                )
            );
        });
        await this.forget(existing);
        this.logger.log('API key revoked', { apiKeyId: id });
    }

    /**
     * Resolves a presented raw key (the gateway's API-key path). Returns null for an unknown, revoked or
     * expired key. Cached per DB Model §3; revocation and rotation delete the cache entry.
     */
    async validateKey(rawKey: string): Promise<ResolvedApiKey | null> {
        const keyHash = this.hash(rawKey);
        const cacheKey = this.cacheKey(rawKey.slice(-4), keyHash);
        const cached = await this.redis.get<ResolvedApiKey & { expiresAt: string | null }>(cacheKey, { tenantScoped: false });
        const resolved = cached ?? (await this.loadActive(keyHash, cacheKey));
        if (!resolved || (resolved.expiresAt && new Date(resolved.expiresAt).getTime() <= Date.now())) {
            return null;
        }

        await this.touch(resolved.id);
        return { id: resolved.id, tenantId: resolved.tenantId, keyType: resolved.keyType };
    }

    private async loadActive(keyHash: string, cacheKey: string): Promise<(ResolvedApiKey & { expiresAt: string | null }) | null> {
        const row = await this.prisma.apiKey.findUnique({
            where: { keyHash },
            select: { id: true, tenantId: true, keyType: true, expiresAt: true, revokedAt: true, deletedAt: true }
        });
        if (!row || row.revokedAt || row.deletedAt) {
            return null;
        }
        const resolved = { id: row.id, tenantId: row.tenantId, keyType: row.keyType, expiresAt: row.expiresAt?.toISOString() ?? null };
        await this.redis.set(cacheKey, resolved, { tenantScoped: false, ttl: KEY_CACHE_TTL_SECONDS });
        return resolved;
    }

    /** `last_used_at` at most once a minute per key — validation runs on every ingestion request. */
    private async touch(id: string): Promise<void> {
        const due = await this.redis.setNx(`apikey:last-used:${id}`, '1', LAST_USED_WRITE_INTERVAL_SECONDS);
        if (due) {
            await this.prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch((error: unknown) => {
                this.logger.warn('Could not record API key use', { apiKeyId: id, reason: error instanceof Error ? error.message : 'unknown' });
            });
        }
    }

    private async forget(key: ApiKeyProps): Promise<void> {
        await this.redis.del(this.cacheKey(key.keyPrefix, key.keyHash), false);
    }

    private async findLive(id: string): Promise<ApiKeyProps> {
        const key = (await this.apiKey.findFirst({ where: { id, deletedAt: null } })) as ApiKeyProps | null;
        if (!key) {
            throw new BaseException('resource_not_found', `API key ${id} not found`, HttpStatus.NOT_FOUND);
        }
        return key;
    }

    /** Generates a key and persists it, regenerating on the (rare) 4-char display-suffix clash in the tenant. */
    private async withFreshKey(
        keyType: ApiKeyType,
        persist: (secret: { keyHash: string; keyPrefix: string }) => Promise<ApiKeyProps>
    ): Promise<{ saved: ApiKeyProps; rawKey: string }> {
        for (let attempt = 1; ; attempt++) {
            const rawKey = `${keyType === ApiKeyType.PUBLISHABLE ? 'rai_pub_' : 'rai_live_'}${randomBytes(32).toString('base64url')}`;
            try {
                const saved = await persist({ keyHash: this.hash(rawKey), keyPrefix: rawKey.slice(-4) });
                return { saved, rawKey };
            } catch (error) {
                const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
                if (!clash || attempt >= MAX_GENERATION_ATTEMPTS) {
                    throw error;
                }
            }
        }
    }

    private hash(rawKey: string): string {
        return createHmac('sha256', this.pepper).update(rawKey, 'utf8').digest('hex');
    }

    private cacheKey(keyPrefix: string, keyHash: string): string {
        return `apikey:${keyPrefix}:${keyHash.slice(0, 8)}`;
    }
}
