import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { IIdempotencyKeyGenerator, IIdempotencyKeyData, IdempotencyScope } from '@app/types';

/**
 * Service for generating idempotency keys
 * Creates deterministic keys based on request data
 */
@Injectable()
export class IdempotencyKeyGenerator implements IIdempotencyKeyGenerator {
    /**
     * Generate an idempotency key
     */
    generate(data: IIdempotencyKeyData, scope: IdempotencyScope = 'global' as IdempotencyScope): string {
        // Use custom key if provided
        if (data.customKey) {
            return this.sanitizeKey(data.customKey);
        }

        const parts: string[] = [];

        // Add scope prefix
        if (scope === 'tenant' as IdempotencyScope && data.tenantId) {
            parts.push(`tenant:${data.tenantId}`);
        } else if (scope === 'user' as IdempotencyScope && data.userId) {
            parts.push(`user:${data.userId}`);
        }

        // Add method and path
        parts.push(data.method.toLowerCase());
        parts.push(this.normalizePath(data.path));

        // Hash body and query if present
        const bodyHash = this.hashObject(data.body);
        if (bodyHash) {
            parts.push(bodyHash);
        }

        const queryHash = this.hashObject(data.query);
        if (queryHash) {
            parts.push(queryHash);
        }

        return parts.join(':');
    }

    /**
     * Normalize URL path
     */
    private normalizePath(path: string): string {
        return path
            .toLowerCase()
            .replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
            .replace(/\/+/g, '/') // Replace multiple slashes with single
            .replace(/[^a-z0-9\-._~/]/g, '-'); // Replace special chars
    }

    /**
     * Hash an object to create a deterministic string
     */
    private hashObject(obj: unknown): string | null {
        if (!obj || (typeof obj === 'object' && Object.keys(obj).length === 0)) {
            return null;
        }

        try {
            // Sort keys for deterministic hashing
            const sorted = this.sortObject(obj);
            const str = JSON.stringify(sorted);
            return createHash('sha256').update(str).digest('hex').substring(0, 16);
        } catch {
            return null;
        }
    }

    /**
     * Sort object keys recursively for deterministic hashing
     */
    private sortObject(obj: unknown): unknown {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map((item) => this.sortObject(item));
        }

        return Object.keys(obj)
            .sort()
            .reduce((result: Record<string, unknown>, key: string) => {
                result[key] = this.sortObject((obj as Record<string, unknown>)[key]);
                return result;
            }, {});
    }

    /**
     * Sanitize custom idempotency key
     */
    private sanitizeKey(key: string): string {
        return key.replace(/[^a-zA-Z0-9\-._:]/g, '-').substring(0, 200);
    }
}