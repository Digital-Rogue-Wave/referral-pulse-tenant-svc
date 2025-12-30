import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { RedisKeyBuilder } from '@mod/common/aws-redis/redis-key.builder';

@Injectable()
export class RedisUsageService {
    private readonly logger = new Logger(RedisUsageService.name);

    // 60 days TTL window for usage counters and threshold flags
    private static readonly USAGE_TTL_SECONDS = 60 * 24 * 60 * 60;
    private static readonly THRESHOLD_TTL_SECONDS = 60 * 24 * 60 * 60;

    constructor(
        private readonly redis: RedisService,
        private readonly keyBuilder: RedisKeyBuilder
    ) {}

    private getCurrentMonth(): string {
        const now = new Date();
        return now.toISOString().slice(0, 7); // YYYY-MM
    }

    private buildUsageKey(tenantId: string, metric: string, month?: string): string {
        const period = month ?? this.getCurrentMonth();
        return this.keyBuilder.build('usage', tenantId, metric, period);
    }

    private buildMetricsSetKey(tenantId: string): string {
        return this.keyBuilder.build('usage-metrics', tenantId);
    }

    private buildLimitKey(tenantId: string, metric: string): string {
        return this.keyBuilder.build('limits', tenantId, metric);
    }

    private buildThresholdKey(tenantId: string, metric: string, percentage: number): string {
        return this.keyBuilder.build('thresholds', tenantId, metric, percentage);
    }

    async incrementUsage(tenantId: string, metric: string, amount = 1): Promise<number> {
        if (amount <= 0) {
            return this.getUsage(tenantId, metric);
        }

        const key = this.buildUsageKey(tenantId, metric);
        const metricsKey = this.buildMetricsSetKey(tenantId);
        const value = await this.redis.incrBy(key, amount);
        await this.redis.expire(key, RedisUsageService.USAGE_TTL_SECONDS);
        await this.redis.sAdd(metricsKey, metric);
        await this.redis.expire(metricsKey, RedisUsageService.USAGE_TTL_SECONDS);
        return value;
    }

    async decrementUsage(tenantId: string, metric: string, amount = 1): Promise<number> {
        if (amount <= 0) {
            return this.getUsage(tenantId, metric);
        }

        const key = this.buildUsageKey(tenantId, metric);
        const value = await this.redis.decrBy(key, amount);

        if (value < 0) {
            // Clamp to zero to avoid negative usage
            await this.redis.set(key, '0', RedisUsageService.USAGE_TTL_SECONDS);
            return 0;
        }

        await this.redis.expire(key, RedisUsageService.USAGE_TTL_SECONDS);
        const metricsKey = this.buildMetricsSetKey(tenantId);
        await this.redis.sAdd(metricsKey, metric);
        await this.redis.expire(metricsKey, RedisUsageService.USAGE_TTL_SECONDS);
        return value;
    }

    async trackUsage(tenantId: string, metric: string, delta: number): Promise<number> {
        if (delta === 0) {
            return this.getUsage(tenantId, metric);
        }

        if (delta > 0) {
            return this.incrementUsage(tenantId, metric, delta);
        }

        return this.decrementUsage(tenantId, metric, Math.abs(delta));
    }

    async getUsage(tenantId: string, metric: string, month?: string): Promise<number> {
        const key = this.buildUsageKey(tenantId, metric, month);
        const raw = await this.redis.get(key);
        if (raw == null) return 0;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    async listMetrics(tenantId: string): Promise<string[]> {
        const metricsKey = this.buildMetricsSetKey(tenantId);
        return this.redis.sMembers(metricsKey);
    }

    async setLimit(tenantId: string, metric: string, limit: number | null): Promise<void> {
        const key = this.buildLimitKey(tenantId, metric);
        if (limit == null) {
            await this.redis.del(key);
            return;
        }

        await this.redis.set(key, String(limit));
    }

    async getLimit(tenantId: string, metric: string): Promise<number | null> {
        const key = this.buildLimitKey(tenantId, metric);
        const raw = await this.redis.get(key);
        if (raw == null) return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }

    async markThresholdTriggered(tenantId: string, metric: string, percentage: number): Promise<void> {
        const key = this.buildThresholdKey(tenantId, metric, percentage);
        await this.redis.set(key, '1', RedisUsageService.THRESHOLD_TTL_SECONDS);
    }

    async isThresholdTriggered(tenantId: string, metric: string, percentage: number): Promise<boolean> {
        const key = this.buildThresholdKey(tenantId, metric, percentage);
        const exists = await this.redis.exists(key);
        return exists === 1;
    }

    async clearMonthlyUsage(tenantId: string, metric: string, month: string): Promise<void> {
        const key = this.buildUsageKey(tenantId, metric, month);
        await this.redis.del(key);
    }

    async clearThresholdFlags(tenantId: string, metric: string, percentages: number[]): Promise<void> {
        for (const percentage of percentages) {
            const key = this.buildThresholdKey(tenantId, metric, percentage);
            await this.redis.del(key);
        }
    }
}
