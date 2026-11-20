import { HttpStatus } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import type { BullJobsService } from '@common/bulljobs';
import type { BaseException } from '@common/exceptions/base.exceptions';
import type { AppLoggerService } from '@common/logging/app-logger.service';
import type { RedisService } from '@common/redis/redis.service';
import type { DatabaseService } from '@app/database/database.service';

import { BREAK_GLASS_PERMISSIONS, BREAK_GLASS_QUEUE, BREAK_GLASS_TTL_SECONDS, BreakGlassService } from './break-glass.service';

const STAFF = 'kratos-staff-1';
const TENANT = '01TENANT0000000000000000T1';

/** Product Spec R-ACT-02 (E1 D17): a Super Admin's access to tenant data is break-glass, time-boxed and audit-logged. */
describe('Break-glass access', () => {
    let redis: MockProxy<RedisService>;
    let bullJobs: MockProxy<BullJobsService>;
    let findTenant: jest.Mock;
    let audit: jest.Mock;
    let service: BreakGlassService;

    beforeEach(() => {
        redis = mock<RedisService>();
        redis.get.mockResolvedValue(undefined);
        bullJobs = mock<BullJobsService>();
        findTenant = jest.fn().mockResolvedValue({ id: TENANT });
        audit = jest.fn().mockResolvedValue(undefined);
        const prisma = { tenant: { findFirst: findTenant }, auditLog: { create: audit } } as unknown as DatabaseService;
        service = new BreakGlassService(prisma as never, redis, bullJobs, mock<AppLoggerService>());
    });

    describe('given a Super Admin opens a window with a reason', () => {
        it('then the window is kept for one hour, scheduled to close, and audited with the reason', async () => {
            const window = await service.open(STAFF, { tenantId: TENANT, reason: 'incident INC-42: payouts stuck' });

            expect(new Date(window.expiresAt).getTime() - new Date(window.openedAt).getTime()).toBe(BREAK_GLASS_TTL_SECONDS * 1000);
            expect(BREAK_GLASS_TTL_SECONDS).toBe(3600);
            expect(redis.set).toHaveBeenCalledWith(
                `break-glass:${STAFF}:${TENANT}`,
                expect.objectContaining({ staffIdentityId: STAFF, tenantId: TENANT, reason: 'incident INC-42: payouts stuck' }),
                { tenantScoped: false, ttl: 3600 }
            );
            expect(bullJobs.addDelayedJob).toHaveBeenCalledWith(
                BREAK_GLASS_QUEUE,
                'expire',
                expect.objectContaining({ tenantId: TENANT, staffIdentityId: STAFF }),
                3_600_000,
                expect.objectContaining({ jobId: expect.stringMatching(/^break-glass-/) })
            );
            expect(audit).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    tenantId: TENANT,
                    actorUserId: `staff:${STAFF}`,
                    action: 'break_glass.opened',
                    reason: 'incident INC-42: payouts stuck'
                })
            });
        });

        it('then an unknown or deleted tenant is a 404, and nothing is opened', async () => {
            findTenant.mockResolvedValue(null);

            const error = await service.open(STAFF, { tenantId: TENANT, reason: 'incident INC-42' }).catch((e: BaseException) => e);

            expect((error as BaseException).getStatus()).toBe(HttpStatus.NOT_FOUND);
            expect(redis.set).not.toHaveBeenCalled();
        });

        it('then a second window on the same tenant while one is open is a 409', async () => {
            redis.get.mockResolvedValue({
                grantId: 'g0',
                staffIdentityId: STAFF,
                tenantId: TENANT,
                reason: 'x',
                openedAt: '',
                expiresAt: new Date(Date.now() + 60_000).toISOString()
            });

            const error = await service.open(STAFF, { tenantId: TENANT, reason: 'incident INC-42' }).catch((e: BaseException) => e);

            expect((error as BaseException).getStatus()).toBe(HttpStatus.CONFLICT);
        });
    });

    describe('given a request made inside the window', () => {
        it('then it is audited with the method, the path and the window reason', async () => {
            const grant = {
                grantId: 'g1',
                staffIdentityId: STAFF,
                tenantId: TENANT,
                reason: 'incident INC-42',
                openedAt: '',
                expiresAt: '2026-11-16T12:00:00.000Z'
            };

            await service.recordRead(grant, { method: 'GET', uri: '/api/v1/rewards' });

            expect(audit).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: 'break_glass.read',
                    actorUserId: `staff:${STAFF}`,
                    reason: 'incident INC-42',
                    after: expect.objectContaining({ method: 'GET', uri: '/api/v1/rewards', grant_id: 'g1' })
                })
            });
        });
    });

    describe('given the hour is up', () => {
        it('then a window whose expiry is past is no longer active', async () => {
            redis.get.mockResolvedValue({
                grantId: 'g1',
                staffIdentityId: STAFF,
                tenantId: TENANT,
                reason: 'x',
                openedAt: '',
                expiresAt: new Date(Date.now() - 1).toISOString()
            });

            await expect(service.activeGrant(STAFF, TENANT)).resolves.toBeNull();
        });

        it('then the expiry job drops the window and records its end', async () => {
            redis.get.mockResolvedValue({ grantId: 'g1' });

            await service.expire({ tenantId: TENANT, grantId: 'g1', staffIdentityId: STAFF });

            expect(redis.del).toHaveBeenCalledWith(`break-glass:${STAFF}:${TENANT}`, false);
            expect(audit).toHaveBeenCalledWith({
                data: expect.objectContaining({ action: 'break_glass.expired', tenantId: TENANT, targetId: STAFF })
            });
        });

        it('then a newer window on the same tenant is not dropped by an older job', async () => {
            redis.get.mockResolvedValue({ grantId: 'g2' });

            await service.expire({ tenantId: TENANT, grantId: 'g1', staffIdentityId: STAFF });

            expect(redis.del).not.toHaveBeenCalled();
        });
    });

    it('lets a break-glass token read, and nothing else', () => {
        expect(BREAK_GLASS_PERMISSIONS).toContain('rewards:read');
        expect(BREAK_GLASS_PERMISSIONS.every((permission) => permission.endsWith(':read'))).toBe(true);
    });
});
