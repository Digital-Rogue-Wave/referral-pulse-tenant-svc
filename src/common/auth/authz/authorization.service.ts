import { Injectable } from '@nestjs/common';

import { RedisService } from '@common/redis/redis.service';

import { KetoService } from '../keto.service';
import {
    KETO_PLATFORM_ADMIN_RELATION,
    KETO_PLATFORM_NAMESPACE,
    KETO_PLATFORM_OBJECT,
    KETO_SERVICE_CALL_RELATION,
    KETO_SERVICES_NAMESPACE,
    ServiceCapability,
    serviceSubject,
    userSubject
} from './keto-tuples';
import { ALL_PERMISSIONS, Permission, splitPermission } from './permission-catalog';

/** DB Model v2 §3 Redis: `keto:decision:*`, 30–60 s — short enough that a role change lands within a minute. */
const DECISION_TTL_SECONDS = 45;

/**
 * Keto-backed authorization decisions with the short-lived decision cache the DB model specifies.
 * Keto stays the source of truth; the cache only bounds how often we ask it.
 */
@Injectable()
export class AuthorizationService {
    constructor(
        private readonly keto: KetoService,
        private readonly redis: RedisService
    ) {}

    /** Live-check a tenant-scoped permission for a user (object = the tenant). */
    async userHas(userId: string, tenantId: string, permission: Permission): Promise<boolean> {
        const { namespace, relation } = splitPermission(permission);
        return this.decide(namespace, tenantId, relation, userSubject(userId));
    }

    async isPlatformAdmin(userId: string): Promise<boolean> {
        return this.decide(KETO_PLATFORM_NAMESPACE, KETO_PLATFORM_OBJECT, KETO_PLATFORM_ADMIN_RELATION, userSubject(userId));
    }

    async serviceHas(clientId: string, capability: ServiceCapability): Promise<boolean> {
        return this.decide(KETO_SERVICES_NAMESPACE, capability, KETO_SERVICE_CALL_RELATION, serviceSubject(clientId));
    }

    /**
     * The `perms` snapshot for the internal JWT (API §2): every catalog permission the user holds in
     * their tenant. Checks run in parallel and share the decision cache, so a warm token re-mint costs
     * Redis round-trips only.
     */
    async resolvePermissions(userId: string, tenantId: string): Promise<Permission[]> {
        const decisions = await Promise.all(
            ALL_PERMISSIONS.map(async (permission) => [permission, await this.userHas(userId, tenantId, permission)] as const)
        );
        return decisions.filter(([, allowed]) => allowed).map(([permission]) => permission);
    }

    private async decide(namespace: string, object: string, relation: string, subject: string): Promise<boolean> {
        const key = `keto:decision:${subject}:${relation}:${namespace}:${object}`;
        const cached = await this.redis.get<string>(key, { tenantScoped: false, serialize: false });
        if (cached !== undefined) {
            return cached === 'allow';
        }
        const allowed = await this.keto.check(namespace, object, relation, subject);
        await this.redis.set(key, allowed ? 'allow' : 'deny', { tenantScoped: false, serialize: false, ttl: DECISION_TTL_SECONDS });
        return allowed;
    }
}
