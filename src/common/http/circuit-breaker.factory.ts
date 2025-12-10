import { Injectable, OnModuleDestroy } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { LRUCache } from 'lru-cache';
import { ConfigService } from '@nestjs/config';
import type { CircuitBreakerConfig } from '@mod/config/http-client.config';
import { AppLoggingService } from '@mod/common/logger/app-logging.service';

export type Breaker<T = unknown> = CircuitBreaker<[() => Promise<T>], T>;

@Injectable()
export class CircuitBreakerFactory implements OnModuleDestroy {
    private readonly cache: LRUCache<string, Breaker<unknown>>;

    constructor(
        private readonly logger: AppLoggingService,
        private readonly config: ConfigService
    ) {
        const maxEntries = this.config.get<number>('cacheConfig.httpBreaker.cacheMax', { infer: true }) ?? 128;
        const ttlMs = this.config.get<number>('cacheConfig.httpBreaker.cacheTtlMs', { infer: true }) ?? 300_000;
        const maxBytes = this.config.get<number>('cacheConfig.httpBreaker.cacheMaxBytes', { infer: true }) ?? 8 * 1024 * 1024;

        this.cache = new LRUCache<string, Breaker<unknown>>({
            max: maxEntries,
            ttl: ttlMs,
            allowStale: false,
            updateAgeOnGet: true,
            maxSize: maxBytes,
            sizeCalculation: () => 8 * 1024
        });
    }

    getOrCreate<T = unknown>(key: string, cfg: CircuitBreakerConfig): Breaker<T> {
        const existing = this.cache.get(key) as Breaker<T> | undefined;
        if (existing) return existing;

        // Action wrapper - accepts a function and executes it
        const action = async (fn: () => Promise<T>): Promise<T> => fn();

        const breaker = new CircuitBreaker<[() => Promise<T>], T>(action, {
            timeout: cfg.timeoutMs,
            errorThresholdPercentage: cfg.errorThresholdPercentage,
            volumeThreshold: cfg.volumeThreshold,
            resetTimeout: cfg.resetTimeoutMs
        });

        breaker.on('open', () => this.logger.warn(`Circuit OPEN: ${key}`));
        breaker.on('halfOpen', () => this.logger.debug(`Circuit HALF-OPEN: ${key}`));
        breaker.on('close', () => this.logger.info(`Circuit CLOSED: ${key}`));
        breaker.on('timeout', () => this.logger.warn(`Circuit TIMEOUT: ${key}`));
        breaker.on('reject', () => this.logger.warn(`Circuit REJECT: ${key}`));
        breaker.on('failure', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Circuit FAILURE: ${key} - ${msg}`);
        });

        this.cache.set(key, breaker as unknown as Breaker<unknown>);
        return breaker;
    }

    async onModuleDestroy(): Promise<void> {
        for (const b of this.cache.values()) {
            b.shutdown();
            b.removeAllListeners();
        }
        await this.cache.clear();
    }
}
