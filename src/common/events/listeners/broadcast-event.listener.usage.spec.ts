import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { BroadcastEventListener } from './broadcast-event.listener';
import { SideEffectService } from '@common/side-effects/side-effect.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { UsageMonthlySummaryEvent, UsageThresholdCrossedEvent } from '@domains/billing';
import { BILLING_EVENTS_TOPIC } from '@app/types';

/**
 * `usage.threshold_crossed` and `usage.monthly_summary` were raised by
 * DailyUsageCalculator / MonthlyUsageReset but had no @OnEvent listener, so they
 * were emitted in-process and dropped — nothing ever reached SNS and no consumer
 * could be notified. These tests pin the two handlers that close that gap.
 */
describe('BroadcastEventListener — usage broadcasts', () => {
    let listener: BroadcastEventListener;
    let sideEffectService: MockProxy<SideEffectService>;
    let redisKeyBuilder: MockProxy<RedisKeyBuilder>;

    beforeEach(async () => {
        sideEffectService = mock<SideEffectService>();
        redisKeyBuilder = mock<RedisKeyBuilder>();
        redisKeyBuilder.buildIdempotencyKey.mockImplementation((key: string) => `idem:${key}`);

        const logger = mock<AppLoggerService>();
        const configService = mock<ConfigService>();
        (configService.get as jest.Mock).mockReturnValue('tenant-svc');

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BroadcastEventListener,
                { provide: SideEffectService, useValue: sideEffectService },
                { provide: AppLoggerService, useValue: logger },
                { provide: ConfigService, useValue: configService },
                { provide: RedisKeyBuilder, useValue: redisKeyBuilder }
            ]
        }).compile();

        listener = module.get<BroadcastEventListener>(BroadcastEventListener);
    });

    it('broadcasts usage.threshold_crossed to the billing topic with the threshold detail', async () => {
        const event = new UsageThresholdCrossedEvent(
            'tenant-1',
            'tenant-1',
            'api_calls',
            80,
            8_000,
            10_000,
            80,
            '2026-09-01',
            '2026-09-01T00:00:00.000Z'
        );

        await listener.handleUsageThresholdCrossed(event);

        expect(sideEffectService.createBroadcastSideEffect).toHaveBeenCalledTimes(1);

        const [aggregateType, tenantId, eventType, topicName, message] = (sideEffectService.createBroadcastSideEffect as jest.Mock).mock.calls[0];

        expect(aggregateType).toBe('billing');
        expect(tenantId).toBe('tenant-1');
        expect(eventType).toBe('usage.threshold_crossed');
        expect(topicName).toBe(BILLING_EVENTS_TOPIC);
        expect(message).toMatchObject({
            metric: 'api_calls',
            threshold: 80,
            usage: 8_000,
            limit: 10_000,
            percentage: 80,
            periodDate: '2026-09-01',
            tenantId: 'tenant-1'
        });
    });

    it('broadcasts usage.monthly_summary to the billing topic with the month and totals', async () => {
        const event = new UsageMonthlySummaryEvent(
            'tenant-2',
            'tenant-2',
            'emails_sent',
            '2026-08',
            42_000,
            50_000,
            '2026-08-31',
            '2026-09-01T00:00:00.000Z'
        );

        await listener.handleUsageMonthlySummary(event);

        const [aggregateType, tenantId, eventType, topicName, message] = (sideEffectService.createBroadcastSideEffect as jest.Mock).mock.calls[0];

        expect(aggregateType).toBe('billing');
        expect(tenantId).toBe('tenant-2');
        expect(eventType).toBe('usage.monthly_summary');
        expect(topicName).toBe(BILLING_EVENTS_TOPIC);
        expect(message).toMatchObject({
            metric: 'emails_sent',
            month: '2026-08',
            usage: 42_000,
            limit: 50_000,
            periodDate: '2026-08-31',
            tenantId: 'tenant-2'
        });
    });

    it('carries a null monthly limit through rather than dropping the field', async () => {
        const event = new UsageMonthlySummaryEvent('tenant-3', 'tenant-3', 'seats', '2026-08', 7, null, '2026-08-31', '2026-09-01T00:00:00.000Z');

        await listener.handleUsageMonthlySummary(event);

        const [, , , , message] = (sideEffectService.createBroadcastSideEffect as jest.Mock).mock.calls[0];

        expect(message).toHaveProperty('limit', null);
    });

    it('does not let a broadcast failure escape into the scheduled job', async () => {
        (sideEffectService.createBroadcastSideEffect as jest.Mock).mockRejectedValue(new Error('SNS unavailable'));
        const event = new UsageThresholdCrossedEvent(
            'tenant-4',
            'tenant-4',
            'api_calls',
            90,
            9_000,
            10_000,
            90,
            '2026-09-01',
            '2026-09-01T00:00:00.000Z'
        );

        await expect(listener.handleUsageThresholdCrossed(event)).resolves.toBeUndefined();
    });
});
