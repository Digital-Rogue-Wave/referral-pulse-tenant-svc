import { Injectable } from '@nestjs/common';
import type { IIdempotencyResult, IIdempotencyOptions } from '@app/types';
import { RedisService } from '@app/common/redis/redis.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { DateService } from '@app/common/helper/date.service';

/**
 * Generic idempotency service for HTTP and RPC calls
 * Prevents duplicate processing of requests using Redis
 */
@Injectable()
export class IdempotencyService {
    private readonly keyPrefix = 'idempotency:';
    private readonly defaultTtl = 86400; // 24 hours
    private readonly defaultLockTimeout = 300; // 5 minutes

    constructor(
        private readonly redisService: RedisService,
        private readonly tracingService: TracingService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService,
    ) {
        this.logger.setContext(IdempotencyService.name);
    }

    /**
     * Check if an idempotency key exists (quick check)
     */
    async isDuplicate(idempotencyKey: string, options?: IIdempotencyOptions): Promise<boolean> {
        return this.tracingService.withSpan('idempotency.isDuplicate', async () => {
            const key = this.buildKey(idempotencyKey, options);
            return this.redisService.exists(key, false);
        });
    }

    /**
     * Check idempotency and return original response if duplicate
     */
    async check<T = unknown>(idempotencyKey: string, options?: IIdempotencyOptions): Promise<IIdempotencyResult<T>> {
        return this.tracingService.withSpan('idempotency.check', async () => {
            const key = this.buildKey(idempotencyKey, options);
            const existing = await this.redisService.get<{ response: T; processedAt: string }>(key, {
                tenantScoped: false,
            });

            if (existing) {
                this.logger.debug(`🔄 Idempotency hit: ${idempotencyKey}`, {
                    key: idempotencyKey,
                    processedAt: existing.processedAt,
                });

                return {
                    isDuplicate: true,
                    originalResponse: existing.response,
                    processedAt: this.dateService.parse(existing.processedAt).toDate(),
                };
            }

            return { isDuplicate: false };
        });
    }

    /**
     * Mark a request as processed with optional response storage
     */
    async markProcessed<T = unknown>(
        idempotencyKey: string,
        response?: T,
        options?: IIdempotencyOptions,
    ): Promise<void> {
        const key = this.buildKey(idempotencyKey, options);
        const storeResponse = options?.storeResponse !== false;

        const value = {
            response: storeResponse ? response : null,
            processedAt: this.dateService.nowISO(),
        };

        await this.redisService.set(key, value, {
            ttl: (options?.ttl || this.defaultTtl) * 1000,
            tenantScoped: false,
        });

        this.logger.debug(`✅ Idempotency key stored: ${idempotencyKey}`, {
            key: idempotencyKey,
            ttl: options?.ttl || this.defaultTtl,
        });
    }

    /**
     * Acquire a lock for processing (prevents race conditions)
     */
    async lock(idempotencyKey: string, options?: IIdempotencyOptions): Promise<boolean> {
        const lockKey = this.buildLockKey(idempotencyKey, options);
        const ttl = (options?.lockTimeout || this.defaultLockTimeout) * 1000;

        const lock = await this.redisService.acquireLock(lockKey, { ttl });

        if (lock.acquired) {
            this.logger.debug(`🔒 Idempotency lock acquired: ${idempotencyKey}`);
        }

        return lock.acquired;
    }

    /**
     * Release a lock
     */
    async unlock(idempotencyKey: string, options?: IIdempotencyOptions): Promise<void> {
        const lockKey = this.buildLockKey(idempotencyKey, options);
        await this.redisService.del(lockKey, false);
        this.logger.debug(`🔓 Idempotency lock released: ${idempotencyKey}`);
    }

    /**
     * Execute an operation only once (handles locking and storage automatically)
     */
    async executeOnce<T>(
        idempotencyKey: string,
        operation: () => Promise<T>,
        options?: IIdempotencyOptions,
    ): Promise<{ result: T; isDuplicate: boolean }> {
        return this.tracingService.withSpan('idempotency.executeOnce', async () => {
            // Check if already processed
            const check = await this.check<T>(idempotencyKey, options);
            if (check.isDuplicate) {
                this.logger.log(`🔄 Returning cached result for: ${idempotencyKey}`);
                return { result: check.originalResponse as T, isDuplicate: true };
            }

            // Acquire lock to prevent concurrent processing
            const locked = await this.lock(idempotencyKey, options);
            if (!locked) {
                // Wait briefly and recheck in case another process just finished
                await new Promise((resolve) => setTimeout(resolve, 100));
                const recheck = await this.check<T>(idempotencyKey, options);
                if (recheck.isDuplicate) {
                    return { result: recheck.originalResponse as T, isDuplicate: true };
                }
                throw new Error(`Failed to acquire idempotency lock: ${idempotencyKey}`);
            }

            try {
                // Execute the operation
                this.logger.debug(`⚙️ Executing operation for: ${idempotencyKey}`);
                const result = await operation();

                // Store the result
                await this.markProcessed(idempotencyKey, result, options);

                return { result, isDuplicate: false };
            } finally {
                // Always release the lock
                await this.unlock(idempotencyKey, options);
            }
        });
    }

    /**
     * Delete an idempotency key (useful for retry scenarios)
     */
    async delete(idempotencyKey: string, options?: IIdempotencyOptions): Promise<void> {
        const key = this.buildKey(idempotencyKey, options);
        await this.redisService.del(key, false);
        this.logger.debug(`🗑️ Idempotency key deleted: ${idempotencyKey}`);
    }

    /**
     * Build full Redis key with prefix
     */
    private buildKey(idempotencyKey: string, options?: IIdempotencyOptions): string {
        const prefix = options?.keyPrefix || this.keyPrefix;
        return `${prefix}${idempotencyKey}`;
    }

    /**
     * Build lock key
     */
    private buildLockKey(idempotencyKey: string, options?: IIdempotencyOptions): string {
        const prefix = options?.keyPrefix || this.keyPrefix;
        return `${prefix}lock:${idempotencyKey}`;
    }
}