import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { LimitExceededException } from './exceptions/limit-exceeded.exception';
import { PlanLimitService } from './plan-limit.service';
import { UsageCounterService } from './usage-counter.service';

const GROWTH = { name: 'Growth', limits: { seats: 3, email_sends: 100, api_keys: 2 } };

describe('PlanLimitService — plan entitlements', () => {
    let prisma: Record<string, Record<string, jest.Mock>>;
    let counters: MockProxy<UsageCounterService>;
    let service: PlanLimitService;

    beforeEach(() => {
        prisma = {
            plan: {
                findFirst: jest.fn(async ({ where }: { where: { name?: string; tenantId?: string | null } }) =>
                    where.name === 'Growth' ? GROWTH : null
                )
            },
            billing: { findUnique: jest.fn().mockResolvedValue({ plan: 'Growth', status: 'active' }) },
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 't1',
                    status: 'active',
                    paymentStatus: 'active',
                    trialEndsAt: null,
                    dataRegion: 'eu-central-1',
                    retentionMonths: 24
                })
            },
            user: { count: jest.fn().mockResolvedValue(2) },
            invitation: { count: jest.fn().mockResolvedValue(1) }
        };
        counters = mock<UsageCounterService>();
        service = new PlanLimitService(prisma as unknown as DatabaseService, mock<AppLoggerService>(), counters, mock<ConfigService>());
    });

    it('resolves limits from the plan catalog by the tenant’s plan name (data, not env price ids)', async () => {
        await expect(service.getPlanLimits('t1')).resolves.toEqual(GROWTH.limits);
        expect(prisma.plan!.findFirst).toHaveBeenLastCalledWith({ where: { name: 'Growth', tenantId: null, isActive: true, deletedAt: null } });
    });

    it('counts seats as members plus invitations that can still be accepted', async () => {
        // 2 users + 1 pending invitation = 3 of 3 seats.
        await expect(service.assertSeatAvailable('t1')).rejects.toBeInstanceOf(LimitExceededException);
        prisma.invitation!.count!.mockResolvedValue(0);
        await expect(service.assertSeatAvailable('t1')).resolves.toBeUndefined();
    });

    it('meters atomically against the limit and reports the usage when it is exhausted', async () => {
        counters.consume.mockResolvedValue(null);
        counters.get.mockResolvedValue(100);

        const error = await service.consume('t1', 'email_sends', 1).catch((e: LimitExceededException) => e);

        expect(counters.consume).toHaveBeenCalledWith('t1', 'email_sends', 1, 100);
        expect(error).toBeInstanceOf(LimitExceededException);
    });

    it('treats a metric the plan does not name as unlimited', async () => {
        counters.consume.mockResolvedValue(7);

        await expect(service.consume('t1', 'webhooks', 1)).resolves.toBe(7);
        expect(counters.consume).toHaveBeenCalledWith('t1', 'webhooks', 1, null);
        await expect(service.getRemainingCapacity('t1', 'webhooks')).resolves.toBeNull();
    });

    it('describes entitlements for other services: limits, usage (seats included) and account state', async () => {
        counters.current.mockResolvedValue({ email_sends: 40 });

        await expect(service.entitlementsOf('t1')).resolves.toMatchObject({
            plan: 'Growth',
            paymentStatus: 'active',
            dataRegion: 'eu-central-1',
            limits: { seats: 3, email_sends: 100, api_keys: 2 },
            usage: { seats: 3, email_sends: 40, api_keys: 0 }
        });
    });
});
