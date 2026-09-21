import { mock } from 'jest-mock-extended';

import { BullJobsService } from '@common/bulljobs';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { SnsPublisherService } from '@common/messaging/sns-publisher.service';
import { SqsProducerService } from '@common/messaging/sqs-producer.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { DatabaseService } from '@app/database/database.service';

import { SideEffectService } from './side-effect.service';

/**
 * The queue client used to be injected through an optional string token that no module provided, so every
 * critical side effect was written to the outbox and never enqueued (nothing swept it up either).
 */
describe('SideEffectService — critical side effects', () => {
    it('writes the outbox row in the caller’s transaction and enqueues it for the worker', async () => {
        const bullJobs = mock<BullJobsService>();
        const tx = { sideEffectOutbox: { create: jest.fn(async ({ data }: { data: object }) => ({ id: 'se-1', ...data })) } };
        const context = mock<TenantContextService>();
        context.getTenantId.mockReturnValue(undefined);
        const service = new SideEffectService(
            mock<DatabaseService>(),
            context,
            mock<AppLoggerService>(),
            mock<SqsProducerService>(),
            mock<SnsPublisherService>(),
            bullJobs
        );

        await service.createKetoSideEffect({ operation: 'grant_tenant', tenantId: 't1' }, { prisma: tx as never });

        expect(tx.sideEffectOutbox.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ tenantId: 't1', effectType: 'keto', status: 'pending' })
        });
        expect(bullJobs.addJob).toHaveBeenCalledWith(
            'outbox-processor',
            'process-keto',
            expect.objectContaining({ sideEffectId: 'se-1' }),
            expect.objectContaining({ jobId: 'se-1' })
        );
    });

    it('keeps the committed row when the enqueue fails — the sweeper picks it up', async () => {
        const bullJobs = mock<BullJobsService>();
        bullJobs.addJob.mockRejectedValue(new Error('redis down'));
        const tx = {
            sideEffectOutbox: {
                create: jest.fn(async () => ({
                    id: 'se-2',
                    effectType: 'keto',
                    aggregateType: 'tenant',
                    aggregateId: 't1',
                    eventType: 'keto.grant_tenant',
                    maxRetries: 10
                }))
            }
        };
        const service = new SideEffectService(
            mock<DatabaseService>(),
            mock<TenantContextService>(),
            mock<AppLoggerService>(),
            mock<SqsProducerService>(),
            mock<SnsPublisherService>(),
            bullJobs
        );

        await expect(service.createKetoSideEffect({ operation: 'grant_tenant', tenantId: 't1' }, { prisma: tx as never })).resolves.toMatchObject({
            id: 'se-2'
        });
    });
});
