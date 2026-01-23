import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { DateService } from '@app/common/helper/date.service';
import type { ClsRequestContext } from '@app/types';
import type { ITenantContext } from '@app/types';

/**
 * Service for managing tenant context using CLS.
 */
@Injectable()
export class ClsTenantContextService implements ITenantContext {
    constructor(
        private readonly cls: ClsService<ClsRequestContext>,
        private readonly dateService: DateService,
    ) {}

    getTenantId(): string | undefined {
        return this.cls.get('tenantId');
    }

    getUserId(): string | undefined {
        return this.cls.get('userId');
    }

    getRequestId(): string | undefined {
        return this.cls.get('requestId');
    }

    getCorrelationId(): string | undefined {
        return this.cls.get('correlationId');
    }

    getTraceId(): string | undefined {
        return this.cls.get('traceId');
    }

    getSpanId(): string | undefined {
        return this.cls.get('spanId');
    }

    getIdempotencyKey(): string | undefined {
        return this.cls.get('idempotencyKey');
    }

    getIp(): string | undefined {
        return this.cls.get('ip');
    }

    getUserAgent(): string | undefined {
        return this.cls.get('userAgent');
    }

    getStartTime(): number | undefined {
        return this.cls.get('startTime');
    }

    getDuration(): number | undefined {
        const startTime = this.getStartTime();
        return startTime ? this.dateService.now() - startTime : undefined;
    }

    getMetadata<T = unknown>(key: string): T | undefined {
        const metadata = this.cls.get('metadata');
        return metadata?.[key] as T | undefined;
    }

    set<K extends keyof ClsRequestContext>(key: K, value: ClsRequestContext[K]): void {
        this.cls.set(key, value);
    }

    setMetadata(key: string, value: unknown): void {
        const metadata = this.cls.get('metadata') || {};
        this.cls.set('metadata', { ...metadata, [key]: value });
    }

    /**
     * Generic get method for accessing any context value
     */
    get<T = any>(key: string): T | undefined {
        return this.cls.get(key as any) as T | undefined;
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

    async runWithContext<T>(
        context: Partial<ClsRequestContext>,
        fn: () => Promise<T>,
    ): Promise<T> {
        return this.cls.run(async () => {
            Object.entries(context).forEach(([key, value]) => {
                if (value !== undefined) {
                    this.cls.set(key as keyof ClsRequestContext, value);
                }
            });
            return fn();
        });
    }

    isActive(): boolean {
        return this.cls.isActive();
    }
}
