import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import type { BaseDomainEvent } from '@domains/common/events';

/** What the access tiers need to know about a tenant. */
export interface TenantAccessState {
    status: string;
    paymentStatus: string;
    deletedAt: string | null;
    lockedAt: string | null;
    lockUntil: string | null;
}

/** Short enough that a change made by another pod (which cannot evict this pod's view) is seen quickly. */
const TTL_SECONDS = 15;
const key = (tenantId: string): string => `tenant-access:${tenantId}`;

/**
 * Cache of the tenant state read on every request by `TenantAccessGuard`. Entries live 15 s and are
 * dropped as soon as a state change commits (suspend, lock, deletion, payment status). Redis being down
 * degrades to a database read, never to an open door.
 */
@Injectable()
export class TenantStateCache {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly redis: RedisService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(TenantStateCache.name);
    }

    async get(tenantId: string): Promise<TenantAccessState | null> {
        const cached = await this.quietly(() => this.redis.get<TenantAccessState>(key(tenantId), { tenantScoped: false }));
        if (cached) {
            return cached;
        }
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { status: true, paymentStatus: true, deletedAt: true, lockedAt: true, lockUntil: true }
        });
        if (!tenant) {
            return null;
        }
        const state: TenantAccessState = {
            status: tenant.status,
            paymentStatus: tenant.paymentStatus,
            deletedAt: tenant.deletedAt?.toISOString() ?? null,
            lockedAt: tenant.lockedAt?.toISOString() ?? null,
            lockUntil: tenant.lockUntil?.toISOString() ?? null
        };
        await this.quietly(() => this.redis.set(key(tenantId), state, { tenantScoped: false, ttl: TTL_SECONDS }));
        return state;
    }

    @OnEvent('tenant.suspended', { async: true })
    @OnEvent('tenant.unsuspended', { async: true })
    @OnEvent('tenant.locked', { async: true })
    @OnEvent('tenant.unlocked', { async: true })
    @OnEvent('tenant.deleted', { async: true })
    @OnEvent('tenant.payment-status-changed', { async: true })
    async evict(event: BaseDomainEvent): Promise<void> {
        await this.quietly(() => this.redis.del(key(event.tenantId), false));
    }

    /** Redis is an optimisation here: a failure is logged and the caller carries on (the entry expires on its own). */
    private async quietly<T>(operation: () => Promise<T>): Promise<T | undefined> {
        try {
            return await operation();
        } catch (error) {
            this.logger.warn('Tenant state cache unavailable', { reason: error instanceof Error ? error.message : 'unknown' });
            return undefined;
        }
    }
}
