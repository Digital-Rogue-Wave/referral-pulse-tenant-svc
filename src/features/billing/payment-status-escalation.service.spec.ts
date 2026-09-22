import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { PaymentStatusEscalationService } from './payment-status-escalation.service';

const NOW = new Date('2026-09-22T00:00:00Z');
const DAY = 86_400_000;

describe('PaymentStatusEscalationService — dunning', () => {
    let findMany: jest.Mock;
    let updateMany: jest.Mock;
    let events: MockProxy<TransactionEventEmitterService>;
    let service: PaymentStatusEscalationService;

    beforeEach(() => {
        findMany = jest.fn().mockResolvedValue([]);
        updateMany = jest.fn().mockResolvedValue({ count: 1 });
        const prisma = { tenant: { findMany, updateMany }, $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ tenant: { updateMany } })) };
        const config = mock<ConfigService>();
        config.get.mockReturnValue({ dunningRestrictAfterDays: 3, dunningLockAfterDays: 10 });
        events = mock<TransactionEventEmitterService>();
        service = new PaymentStatusEscalationService(prisma as unknown as DatabaseService, mock<AppLoggerService>(), events, config);
    });

    it('uses the configured days for each step', async () => {
        await service.runEscalation(NOW);

        const [pastDue, restricted] = findMany.mock.calls.map(([args]) => args.where);
        expect(pastDue).toMatchObject({ paymentStatus: 'past_due' });
        expect(pastDue.OR[1].paymentStatusChangedAt.lte).toEqual(new Date(NOW.getTime() - 3 * DAY));
        expect(restricted.OR[1].paymentStatusChangedAt.lte).toEqual(new Date(NOW.getTime() - 10 * DAY));
    });

    it('escalates with a compare-and-set on the previous status and publishes the change', async () => {
        findMany.mockResolvedValueOnce([{ id: 't1', paymentStatusChangedAt: new Date(NOW.getTime() - 5 * DAY) }]).mockResolvedValueOnce([]);

        await service.runEscalation(NOW);

        expect(updateMany).toHaveBeenCalledWith({
            where: { id: 't1', paymentStatus: 'past_due' },
            data: { paymentStatus: 'restricted', paymentStatusChangedAt: NOW }
        });
        expect(events.emitAfterCommit).toHaveBeenCalledWith('tenant.payment-status-changed', expect.objectContaining({ nextStatus: 'restricted' }));
    });

    it('does not announce anything when a payment restored the tenant during the run', async () => {
        findMany.mockResolvedValueOnce([{ id: 't1', paymentStatusChangedAt: new Date(0) }]).mockResolvedValueOnce([]);
        updateMany.mockResolvedValue({ count: 0 });

        await service.runEscalation(NOW);

        expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('starts the clock for a status set without a timestamp instead of escalating at once', async () => {
        findMany.mockResolvedValueOnce([{ id: 't1', paymentStatusChangedAt: null }]).mockResolvedValueOnce([]);

        await service.runEscalation(NOW);

        expect(updateMany).toHaveBeenCalledWith({
            where: { id: 't1', paymentStatus: 'past_due', paymentStatusChangedAt: null },
            data: { paymentStatusChangedAt: NOW }
        });
        expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });
});
