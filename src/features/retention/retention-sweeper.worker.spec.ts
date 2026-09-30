import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import { BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { DatabaseService } from '@app/database/database.service';

import { RetentionSweeperWorker } from './retention-sweeper.worker';

describe('RetentionSweeperWorker', () => {
    let prisma: MockProxy<DatabaseService>;
    let worker: RetentionSweeperWorker;
    const cutoff = new Date('2025-09-22T00:00:00Z');

    beforeEach(() => {
        prisma = mock<DatabaseService>();
        Object.assign(prisma, {
            tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't-closed' }]) },
            auditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 12 }) },
            invitation: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
            sideEffectOutbox: { deleteMany: jest.fn().mockResolvedValue({ count: 40 }) },
            stripeEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 7 }) }
        });
        worker = new RetentionSweeperWorker(
            mock<BullJobsConnectionFactory>(),
            mock<ConfigService>(),
            mock<AppLoggerService>(),
            mock<MetricsService>(),
            mock<TracingService>(),
            mock<TenantContextService>(),
            mock<DateService>(),
            prisma,
            mock<BullJobsService>()
        );
    });

    it('keeps the audit trail of a live tenant, and deletes it 12 months after the tenant closed', async () => {
        await expect(worker.purgeAuditOfClosedTenants(cutoff)).resolves.toBe(12);

        expect(prisma.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'closed', deletedAt: { lt: cutoff } } }));
        expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { tenantId: { in: ['t-closed'] } } });
    });

    it('touches no audit row when no tenant closed long enough ago', async () => {
        (prisma.tenant.findMany as jest.Mock).mockResolvedValue([]);

        await expect(worker.purgeAuditOfClosedTenants(cutoff)).resolves.toBe(0);
        expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes invitations (and the address they hold) once they can no longer be accepted', async () => {
        await worker.purgeEndedInvitations(cutoff);

        expect(prisma.invitation.deleteMany).toHaveBeenCalledWith({
            where: {
                OR: [
                    { status: 'PENDING', expiresAt: { lt: cutoff } },
                    { status: { not: 'PENDING' }, updatedAt: { lt: cutoff } }
                ]
            }
        });
    });

    it('prunes only delivered side effects, never pending or failed ones', async () => {
        await worker.purgeDoneSideEffects(cutoff);

        expect(prisma.sideEffectOutbox.deleteMany).toHaveBeenCalledWith({ where: { status: 'completed', updatedAt: { lt: cutoff } } });
    });

    it('prunes applied Stripe events but keeps failed ones for an operator', async () => {
        await worker.purgeDoneStripeEvents(cutoff);

        expect(prisma.stripeEvent.deleteMany).toHaveBeenCalledWith({
            where: { status: { in: ['processed', 'ignored'] }, receivedAt: { lt: cutoff } }
        });
    });
});
