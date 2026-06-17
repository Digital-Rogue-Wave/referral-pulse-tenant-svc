import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AxiosResponse } from 'axios';
import { LRUCache } from 'lru-cache';
import CircuitBreaker from 'opossum';

import type { CircuitBreakerInfo, ICircuitBreakerConfig } from '@app/types';

import { AppLoggerService } from '@common/logging/app-logger.service';

import type { AllConfigType } from '@config/config.type';

/**
 * CircuitBreakerService
 *
 * Provides resilience patterns for external service calls:
 * - Circuit breaker pattern to prevent cascading failures
 * - LRU cache for circuit breaker instances per service
 * - Configurable thresholds and timeouts
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures exceeded threshold, requests fail fast
 * - HALF_OPEN: Testing if service recovered
 */
@Injectable()
export class CircuitBreakerService implements OnModuleInit, OnModuleDestroy {
    private circuitBreakers: LRUCache<string, CircuitBreaker<[() => Promise<AxiosResponse>], AxiosResponse>>;
    private readonly enabled: boolean;
    private readonly config: ICircuitBreakerConfig;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(CircuitBreakerService.name);

        this.enabled = this.configService.getOrThrow('resilience.circuitBreaker.enabled', { infer: true });
        this.config = {
            failureThreshold: this.configService.getOrThrow('resilience.circuitBreaker.failureThreshold', {
                infer: true
            }),
            halfOpenMaxCalls: this.configService.getOrThrow('resilience.circuitBreaker.halfOpenMaxCalls', {
                infer: true
            }),
            monitoringPeriod: this.configService.getOrThrow('resilience.circuitBreaker.monitoringPeriod', {
                infer: true
            }),
            timeout: this.configService.getOrThrow('resilience.circuitBreaker.timeout', { infer: true }),
            errorThresholdPercentage: this.configService.getOrThrow('resilience.circuitBreaker.errorThresholdPercentage', { infer: true }),
            resetTimeout: this.configService.getOrThrow('resilience.circuitBreaker.resetTimeout', { infer: true }),
            volumeThreshold: this.configService.getOrThrow('resilience.circuitBreaker.volumeThreshold', {
                infer: true
            })
        };

        const maxCacheSize = this.configService.getOrThrow('resilience.circuitBreaker.maxCacheSize', { infer: true });
        this.circuitBreakers = new LRUCache({
            max: maxCacheSize,
            dispose: (breaker) => {
                breaker.shutdown();
            }
        });
    }

    async onModuleInit(): Promise<void> {
        this.logger.log('Circuit Breaker Service initialized', {
            enabled: this.enabled,
            config: this.config
        });
    }

    async onModuleDestroy(): Promise<void> {
        for (const [name, breaker] of this.circuitBreakers.entries()) {
            breaker.shutdown();
            this.logger.debug(`Circuit breaker shutdown: ${name}`);
        }
        this.circuitBreakers.clear();
    }

    /**
     * Check if circuit breaker is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Get or create a circuit breaker for a service
     */
    getBreaker(serviceName: string): CircuitBreaker<[() => Promise<AxiosResponse>], AxiosResponse> {
        let breaker = this.circuitBreakers.get(serviceName);
        if (!breaker) {
            breaker = new CircuitBreaker(async (fn: () => Promise<AxiosResponse>) => fn(), {
                timeout: this.config.timeout,
                errorThresholdPercentage: this.config.errorThresholdPercentage,
                resetTimeout: this.config.resetTimeout,
                volumeThreshold: this.config.volumeThreshold
            });

            breaker.on('open', () => this.logger.warn(`Circuit breaker OPEN: ${serviceName}`));
            breaker.on('halfOpen', () => this.logger.log(`Circuit breaker HALF_OPEN: ${serviceName}`));
            breaker.on('close', () => this.logger.log(`Circuit breaker CLOSED: ${serviceName}`));

            this.circuitBreakers.set(serviceName, breaker);
        }
        return breaker;
    }

    /**
     * Execute a function through the circuit breaker
     */
    async execute<T>(serviceName: string, fn: () => Promise<T>): Promise<T> {
        if (!this.enabled) {
            return fn();
        }

        const breaker = this.getBreaker(serviceName);
        return (await breaker.fire(fn as () => Promise<AxiosResponse>)) as unknown as Promise<T>;
    }

    /**
     * Get circuit breaker state for a service
     */
    getState(serviceName: string): CircuitBreakerInfo | undefined {
        const breaker = this.circuitBreakers.get(serviceName);
        if (!breaker) {
            return undefined;
        }
        const stats = breaker.stats;
        return {
            name: serviceName,
            state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
            failures: stats.failures,
            successes: stats.successes,
            totalCalls: stats.failures + stats.successes,
            consecutiveSuccesses: 0,
            windowStart: Date.now()
        };
    }

    /**
     * Get all circuit breaker states
     */
    getAllStates(): CircuitBreakerInfo[] {
        const states: CircuitBreakerInfo[] = [];
        for (const [name, breaker] of this.circuitBreakers.entries()) {
            const stats = breaker.stats;
            states.push({
                name,
                state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
                failures: stats.failures,
                successes: stats.successes,
                totalCalls: stats.failures + stats.successes,
                consecutiveSuccesses: 0,
                windowStart: Date.now()
            });
        }
        return states;
    }

    /**
     * Reset a circuit breaker
     */
    reset(serviceName: string): void {
        const breaker = this.circuitBreakers.get(serviceName);
        if (breaker) {
            breaker.close();
            this.logger.log(`Circuit breaker reset: ${serviceName}`);
        }
    }

    /**
     * Reset all circuit breakers
     */
    resetAll(): void {
        for (const [name, breaker] of this.circuitBreakers.entries()) {
            breaker.close();
            this.logger.log(`Circuit breaker reset: ${name}`);
        }
    }
}
