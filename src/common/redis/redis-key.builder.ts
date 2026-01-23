import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AllConfigType } from '@app/config/config.type';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';

/**
 * Redis Key Builder Service
 *
 * Builds consistent, sanitized Redis keys with multi-tenancy support.
 * Ensures keys are free of spaces and special characters that could cause issues.
 *
 * Key Pattern:
 * - Tenant-scoped: {prefix}{tenantId}:{namespace}:{key}
 * - Global: {prefix}{namespace}:{key}
 *
 * Examples:
 * - campaign:tenant_123:cache:campaign_abc
 * - campaign:lock:import_xyz
 * - campaign:tenant_456:session:user_789
 */
@Injectable()
export class RedisKeyBuilder {
    private readonly keyPrefix: string;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: ClsTenantContextService,
    ) {
        this.keyPrefix = this.configService.getOrThrow('redis.keyPrefix', { infer: true });
    }

    /**
     * Build a tenant-scoped key
     * Requires active tenant context
     *
     * @param namespace - Key namespace (e.g., 'cache', 'lock', 'session')
     * @param key - The key identifier
     * @returns Sanitized Redis key
     */
    buildTenantKey(namespace: string, key: string): string {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId) {
            throw new Error('Tenant context is required for tenant-scoped Redis keys');
        }

        const sanitizedTenantId = this.sanitize(tenantId);
        const sanitizedNamespace = this.sanitize(namespace);
        const sanitizedKey = this.sanitize(key);

        return `${this.keyPrefix}${sanitizedTenantId}:${sanitizedNamespace}:${sanitizedKey}`;
    }

    /**
     * Build a global key (not tenant-scoped)
     * Use for system-wide resources
     *
     * @param namespace - Key namespace (e.g., 'config', 'feature-flags')
     * @param key - The key identifier
     * @returns Sanitized Redis key
     */
    buildGlobalKey(namespace: string, key: string): string {
        const sanitizedNamespace = this.sanitize(namespace);
        const sanitizedKey = this.sanitize(key);

        return `${this.keyPrefix}${sanitizedNamespace}:${sanitizedKey}`;
    }

    /**
     * Build a lock key for distributed locking
     *
     * @param resource - Resource being locked
     * @param tenantScoped - Whether lock is tenant-specific
     * @returns Sanitized lock key
     */
    buildLockKey(resource: string, tenantScoped = true): string {
        const sanitizedResource = this.sanitize(resource);

        if (tenantScoped) {
            return this.buildTenantKey('lock', sanitizedResource);
        }

        return this.buildGlobalKey('lock', sanitizedResource);
    }

    /**
     * Build a cache key
     *
     * @param cacheKey - Cache identifier
     * @param tenantScoped - Whether cache is tenant-specific
     * @returns Sanitized cache key
     */
    buildCacheKey(cacheKey: string, tenantScoped = true): string {
        const sanitizedKey = this.sanitize(cacheKey);

        if (tenantScoped) {
            return this.buildTenantKey('cache', sanitizedKey);
        }

        return this.buildGlobalKey('cache', sanitizedKey);
    }

    /**
     * Build a session key
     *
     * @param sessionId - Session identifier
     * @param tenantScoped - Whether session is tenant-specific
     * @returns Sanitized session key
     */
    buildSessionKey(sessionId: string, tenantScoped = true): string {
        const sanitizedId = this.sanitize(sessionId);

        if (tenantScoped) {
            return this.buildTenantKey('session', sanitizedId);
        }

        return this.buildGlobalKey('session', sanitizedId);
    }

    /**
     * Build an idempotency key
     *
     * @param idempotencyKey - Idempotency identifier
     * @param tenantScoped - Whether idempotency is tenant-specific
     * @returns Sanitized idempotency key
     */
    buildIdempotencyKey(idempotencyKey: string, tenantScoped = true): string {
        const sanitizedKey = this.sanitize(idempotencyKey);

        if (tenantScoped) {
            return this.buildTenantKey('idempotency', sanitizedKey);
        }

        return this.buildGlobalKey('idempotency', sanitizedKey);
    }

    /**
     * Build a pattern for key scanning/deletion
     *
     * @param namespace - Key namespace
     * @param pattern - Glob pattern (e.g., 'user:*', '*')
     * @param tenantScoped - Whether pattern is tenant-specific
     * @returns Redis key pattern
     */
    buildPattern(namespace: string, pattern: string, tenantScoped = true): string {
        const sanitizedNamespace = this.sanitize(namespace);
        // Don't sanitize pattern - it may contain wildcards

        if (tenantScoped) {
            const tenantId = this.tenantContext.getTenantId();
            if (!tenantId) {
                throw new Error('Tenant context is required for tenant-scoped patterns');
            }
            const sanitizedTenantId = this.sanitize(tenantId);
            return `${this.keyPrefix}${sanitizedTenantId}:${sanitizedNamespace}:${pattern}`;
        }

        return `${this.keyPrefix}${sanitizedNamespace}:${pattern}`;
    }

    /**
     * Extract tenant ID from a key (if tenant-scoped)
     *
     * @param key - Redis key
     * @returns Tenant ID or null
     */
    extractTenantId(key: string): string | null {
        // Remove prefix first
        const withoutPrefix = key.startsWith(this.keyPrefix) ? key.slice(this.keyPrefix.length) : key;

        // Pattern: {tenantId}:{namespace}:{key}
        const parts = withoutPrefix.split(':');
        if (parts.length >= 3) {
            // First part is tenant ID if key follows our pattern
            return parts[0];
        }

        return null;
    }

    /**
     * Sanitize key component to remove spaces and special characters
     * Allows: alphanumeric, hyphens, underscores
     * Replaces spaces with underscores
     * Removes other special characters
     *
     * @param value - Value to sanitize
     * @returns Sanitized value
     */
    private sanitize(value: string): string {
        if (!value) {
            throw new Error('Redis key component cannot be empty');
        }

        return (
            value
                // Replace spaces with underscores
                .replace(/\s+/g, '_')
                // Remove special characters except hyphens and underscores
                .replace(/[^a-zA-Z0-9\-_]/g, '')
                // Remove consecutive underscores
                .replace(/_+/g, '_')
                // Remove leading/trailing underscores
                .replace(/^_+|_+$/g, '')
                // Convert to lowercase for consistency
                .toLowerCase()
        );
    }

    /**
     * Validate if a key follows expected pattern
     *
     * @param key - Key to validate
     * @returns true if valid
     */
    isValidKey(key: string): boolean {
        // Must start with prefix
        if (!key.startsWith(this.keyPrefix)) {
            return false;
        }

        // Must have at least namespace and key part
        const withoutPrefix = key.slice(this.keyPrefix.length);
        const parts = withoutPrefix.split(':');

        return parts.length >= 2 && parts.every((part) => part.length > 0);
    }
}