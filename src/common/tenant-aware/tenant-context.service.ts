import { AsyncLocalStorage } from 'async_hooks';

import { Injectable } from '@nestjs/common';

import type { RequestContext, ITenantContext } from '@app/types';

import { DateService } from '@common/helper/date.service';

/**
 * AsyncLocalStorage instance for request context.
 * Exported for use in middleware setup.
 */
export const alsStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Service for managing tenant context using AsyncLocalStorage.
 */
@Injectable()
export class TenantContextService implements ITenantContext {
    constructor(private readonly dateService: DateService) {}

    private getStore(): RequestContext | undefined {
        return alsStorage.getStore();
    }

    getTenantId(): string | undefined {
        return this.getStore()?.tenantId;
    }

    getUserId(): string | undefined {
        return this.getStore()?.userId;
    }

    getRequestId(): string | undefined {
        return this.getStore()?.requestId;
    }

    getCorrelationId(): string | undefined {
        return this.getStore()?.correlationId;
    }

    getTraceId(): string | undefined {
        return this.getStore()?.traceId;
    }

    getSpanId(): string | undefined {
        return this.getStore()?.spanId;
    }

    getIdempotencyKey(): string | undefined {
        return this.getStore()?.idempotencyKey;
    }

    getIp(): string | undefined {
        return this.getStore()?.ip;
    }

    getUserAgent(): string | undefined {
        return this.getStore()?.userAgent;
    }

    getStartTime(): number | undefined {
        return this.getStore()?.startTime;
    }

    getDuration(): number | undefined {
        const startTime = this.getStartTime();
        return startTime ? this.dateService.now() - startTime : undefined;
    }

    getMetadata<T = unknown>(key: string): T | undefined {
        const metadata = this.getStore()?.metadata;
        return metadata?.[key] as T | undefined;
    }

    set<K extends keyof RequestContext>(key: K, value: RequestContext[K]): void {
        const store = this.getStore();
        if (store) {
            store[key] = value;
        }
    }

    setMetadata(key: string, value: unknown): void {
        const store = this.getStore();
        if (store) {
            store.metadata = { ...store.metadata, [key]: value };
        }
    }

    /**
     * Generic get method for accessing any context value
     */
    get<K extends keyof RequestContext>(key: K): RequestContext[K] | undefined {
        return this.getStore()?.[key];
    }

    getLogContext(): Record<string, string | undefined> {
        return {
            tenantId: this.getTenantId(),
            userId: this.getUserId(),
            requestId: this.getRequestId(),
            correlationId: this.getCorrelationId(),
            traceId: this.getTraceId(),
            spanId: this.getSpanId(),
        };
    }

    async runWithContext<T>(context: Partial<RequestContext>, fn: () => Promise<T>): Promise<T> {
        const fullContext: RequestContext = {
            requestId: context.requestId ?? '',
            tenantId: context.tenantId ?? '',
            userId: context.userId ?? '',
            ...context,
        };
        return alsStorage.run(fullContext, fn);
    }

    isActive(): boolean {
        return this.getStore() !== undefined;
    }
}
