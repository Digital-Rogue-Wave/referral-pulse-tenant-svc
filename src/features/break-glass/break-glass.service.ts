import { HttpStatus, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import { BullJobsService } from '@common/bulljobs';
import { ALL_PERMISSIONS, Permission, splitPermission } from '@common/auth/authz/permission-catalog';
import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import { PrivilegedDatabaseService } from '@app/database/privileged-database.service';
import { BreakGlassGrant, BreakGlassResponse, OpenBreakGlassDto } from '@domains/break-glass';

/** One hour (E1 D17). Not in the spec — to discuss. */
export const BREAK_GLASS_TTL_SECONDS = 60 * 60;
export const BREAK_GLASS_QUEUE = 'break-glass-expiry';
export const BREAK_GLASS_EXPIRE_JOB = 'expire';

/**
 * What a break-glass token may do: every catalogue permission whose relation is `read`, nothing else. Writes, money
 * and live-checked permissions stay closed — staff look, they never act as the tenant.
 */
export const BREAK_GLASS_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter((permission) => splitPermission(permission).relation === 'read');

const grantKey = (staffIdentityId: string, tenantId: string): string => `break-glass:${staffIdentityId}:${tenantId}`;
const NOT_TENANT_SCOPED = { tenantScoped: false } as const;

export interface BreakGlassExpiryJob {
    tenantId: string;
    grantId: string;
    staffIdentityId: string;
}

/**
 * Break-glass access (Product Spec R-ACT-02, E1 D17): a Super Admin's time-boxed, audit-logged read access to one
 * tenant's data. The window lives in Redis for one hour; a BullMQ delayed job closes it and records the expiry. Every
 * request made inside it is audited at the token exchange (`CredentialResolverService`), with the window's reason.
 */
@Injectable()
export class BreakGlassService {
    constructor(
        private readonly prisma: PrivilegedDatabaseService,
        private readonly redis: RedisService,
        private readonly bullJobs: BullJobsService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(BreakGlassService.name);
    }

    async open(staffIdentityId: string, dto: OpenBreakGlassDto): Promise<BreakGlassResponse> {
        const tenant = await this.prisma.tenant.findFirst({ where: { id: dto.tenantId, deletedAt: null }, select: { id: true } });
        if (!tenant) {
            throw new BaseException('tenant_not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
        }
        if (await this.activeGrant(staffIdentityId, dto.tenantId)) {
            throw new BaseException('state_conflict', 'A break-glass window on this tenant is already open', HttpStatus.CONFLICT);
        }

        const openedAt = new Date();
        const grant: BreakGlassGrant = {
            grantId: ulid(),
            staffIdentityId,
            tenantId: dto.tenantId,
            reason: dto.reason,
            openedAt: openedAt.toISOString(),
            expiresAt: new Date(openedAt.getTime() + BREAK_GLASS_TTL_SECONDS * 1000).toISOString()
        };
        await this.redis.set(grantKey(staffIdentityId, dto.tenantId), grant, { ...NOT_TENANT_SCOPED, ttl: BREAK_GLASS_TTL_SECONDS });
        await this.bullJobs.addDelayedJob<BreakGlassExpiryJob>(
            BREAK_GLASS_QUEUE,
            BREAK_GLASS_EXPIRE_JOB,
            { tenantId: grant.tenantId, grantId: grant.grantId, staffIdentityId },
            BREAK_GLASS_TTL_SECONDS * 1000,
            { jobId: `break-glass-${grant.grantId}` }
        );
        await this.audit(grant, 'break_glass.opened', openedAt);
        this.logger.warn('Break-glass window opened', { tenantId: grant.tenantId, grantId: grant.grantId, expiresAt: grant.expiresAt });
        return { tenantId: grant.tenantId, reason: grant.reason, openedAt: grant.openedAt, expiresAt: grant.expiresAt };
    }

    /** The open window of this staff member on this tenant, or null. */
    async activeGrant(staffIdentityId: string, tenantId: string): Promise<BreakGlassGrant | null> {
        const grant = await this.redis.get<BreakGlassGrant>(grantKey(staffIdentityId, tenantId), NOT_TENANT_SCOPED);
        return grant && new Date(grant.expiresAt).getTime() > Date.now() ? grant : null;
    }

    /** One audit row per request made inside the window: which call, under which reason. */
    async recordRead(grant: BreakGlassGrant, request: { method?: string; uri?: string }): Promise<void> {
        await this.audit(grant, 'break_glass.read', new Date(), { method: request.method ?? null, uri: request.uri ?? null });
    }

    /** The delayed job: the window is over. The Redis TTL has normally dropped it already; this makes it certain. */
    async expire(job: BreakGlassExpiryJob): Promise<void> {
        const grant = await this.redis.get<BreakGlassGrant>(grantKey(job.staffIdentityId, job.tenantId), NOT_TENANT_SCOPED);
        if (grant?.grantId === job.grantId) {
            await this.redis.del(grantKey(job.staffIdentityId, job.tenantId), false);
        }
        await this.prisma.auditLog.create({
            data: {
                id: ulid(),
                tenantId: job.tenantId,
                actorUserId: 'system',
                action: 'break_glass.expired',
                targetType: 'staff',
                targetId: job.staffIdentityId,
                after: { grant_id: job.grantId },
                occurredAt: new Date()
            }
        });
    }

    private async audit(grant: BreakGlassGrant, action: string, at: Date, after?: Record<string, unknown>): Promise<void> {
        await this.prisma.auditLog.create({
            data: {
                id: ulid(),
                tenantId: grant.tenantId,
                actorUserId: `staff:${grant.staffIdentityId}`,
                action,
                targetType: 'tenant',
                targetId: grant.tenantId,
                reason: grant.reason,
                after: { grant_id: grant.grantId, expires_at: grant.expiresAt, ...after },
                occurredAt: at
            }
        });
    }
}
