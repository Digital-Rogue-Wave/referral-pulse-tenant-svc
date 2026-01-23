import { Injectable, Optional } from '@nestjs/common';
import SIMDJSON from 'simdjson';
import { MetricsService } from '@app/common/monitoring/metrics.service';

/**
 * JsonService - High-performance JSON parsing and stringification using simdjson
 * Provides significantly faster JSON operations compared to native JSON.parse/stringify
 * Includes performance monitoring and automatic fallback to native JSON
 */
@Injectable()
export class JsonService {
    private parseCount = 0;
    private fallbackCount = 0;
    private totalParseTime = 0;

    constructor(@Optional() private readonly metricsService?: MetricsService) {}
    /**
     * Parse JSON string to object using simdjson (faster than native JSON.parse)
     * Falls back to native JSON.parse if simdjson fails
     * Tracks performance metrics when MetricsService is available
     */
    parse<T = unknown>(text: string): T {
        const startTime = Date.now();
        let usedFallback = false;

        try {
            const result = SIMDJSON.parse(text) as T;
            this.recordMetrics(startTime, text.length, false);
            return result;
        } catch (error) {
            // Fallback to native JSON.parse for edge cases
            usedFallback = true;
            const result = JSON.parse(text) as T;
            this.recordMetrics(startTime, text.length, true);
            return result;
        }
    }

    /**
     * Record performance metrics for JSON operations
     */
    private recordMetrics(startTime: number, size: number, usedFallback: boolean): void {
        const duration = Date.now() - startTime;
        this.parseCount++;
        this.totalParseTime += duration;

        if (usedFallback) {
            this.fallbackCount++;
        }

        // Record to MetricsService if available
        if (this.metricsService) {
            this.metricsService.recordJsonParse(duration, size, usedFallback);
        }
    }

    /**
     * Stringify object to JSON string
     * Currently uses native JSON.stringify as simdjson doesn't provide stringify
     * Can be extended with custom optimizations if needed
     */
    stringify(value: unknown, replacer?: (key: string, value: unknown) => unknown, space?: string | number): string {
        if (replacer || space !== undefined) {
            return JSON.stringify(value, replacer as any, space);
        }
        return JSON.stringify(value);
    }

    /**
     * Parse JSON with safe error handling
     * Returns null if parsing fails instead of throwing
     */
    safeParse<T = unknown>(text: string): T | null {
        try {
            return this.parse<T>(text);
        } catch {
            return null;
        }
    }

    /**
     * Check if string is valid JSON
     */
    isValidJson(text: string): boolean {
        try {
            this.parse(text);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Parse JSON with default value on failure
     */
    parseWithDefault<T>(text: string, defaultValue: T): T {
        try {
            return this.parse<T>(text);
        } catch {
            return defaultValue;
        }
    }

    /**
     * Deep clone an object using JSON serialization
     * Fast alternative to manual deep cloning
     */
    deepClone<T>(obj: T): T {
        return this.parse<T>(this.stringify(obj));
    }

    /**
     * Get performance statistics
     */
    getStats(): {
        totalParses: number;
        fallbackCount: number;
        fallbackRate: number;
        averageParseTime: number;
    } {
        return {
            totalParses: this.parseCount,
            fallbackCount: this.fallbackCount,
            fallbackRate: this.parseCount > 0 ? (this.fallbackCount / this.parseCount) * 100 : 0,
            averageParseTime: this.parseCount > 0 ? this.totalParseTime / this.parseCount : 0,
        };
    }

    /**
     * Reset performance statistics
     */
    resetStats(): void {
        this.parseCount = 0;
        this.fallbackCount = 0;
        this.totalParseTime = 0;
    }
}
