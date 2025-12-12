import { Test, TestingModule } from '@nestjs/testing';
import { TenantListener } from './tenant.listener';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { AuditService } from '@mod/common/audit/audit.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { getQueueToken } from '@nestjs/bullmq';
import { TENANT_DELETION_QUEUE } from '@mod/common/bullmq/queues/tenant-deletion.queue';
import { TenantEntity } from '../tenant.entity';

describe('TenantListener', () => {
    let listener: TenantListener;
    let queueMock: { add: jest.Mock; getJob: jest.Mock };
    let snsMock: { publish: jest.Mock };
    let auditServiceMock: { log: jest.Mock };
    let ketoServiceMock: { check: jest.Mock };

    const mockTenant = {
        id: 'tenant-123',
        name: 'Test Tenant',
        slug: 'test-tenant'
    } as TenantEntity;

    beforeEach(async () => {
        queueMock = {
            add: jest.fn(),
            getJob: jest.fn()
        };
        snsMock = { publish: jest.fn() };
        auditServiceMock = { log: jest.fn() };
        ketoServiceMock = { check: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantListener,
                { provide: SnsPublisher, useValue: snsMock },
                { provide: AuditService, useValue: auditServiceMock },
                { provide: KetoService, useValue: ketoServiceMock },
                { provide: getQueueToken(TENANT_DELETION_QUEUE), useValue: queueMock }
            ]
        }).compile();

        listener = module.get<TenantListener>(TenantListener);
    });

    it('should be defined', () => {
        expect(listener).toBeDefined();
    });

    describe('handleTenantDeletionScheduledEvent', () => {
        it('should schedule a deletion job', async () => {
            const scheduledAt = new Date();
            const executionDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days later
            const payload = {
                tenant: mockTenant,
                userId: 'user-1',
                scheduledAt,
                executionDate,
                reason: 'Test reason'
            };

            await listener.handleTenantDeletionScheduledEvent(payload);

            expect(auditServiceMock.log).toHaveBeenCalled();
            expect(snsMock.publish).toHaveBeenCalled();
            expect(queueMock.add).toHaveBeenCalledWith(
                'execute-deletion',
                {
                    tenantId: mockTenant.id,
                    scheduledAt: scheduledAt.toISOString(),
                    executionDate: executionDate.toISOString(),
                    reason: 'Test reason'
                },
                expect.objectContaining({
                    jobId: `deletion-${mockTenant.id}`,
                    delay: expect.any(Number)
                })
            );
        });
    });

    describe('handleTenantDeletionCancelledEvent', () => {
        it('should remove the deletion job if it exists', async () => {
            const payload = {
                tenant: mockTenant,
                userId: 'user-1'
            };

            const jobMock = { remove: jest.fn() };
            queueMock.getJob.mockResolvedValue(jobMock);

            await listener.handleTenantDeletionCancelledEvent(payload);

            expect(auditServiceMock.log).toHaveBeenCalled();
            expect(snsMock.publish).toHaveBeenCalled();
            expect(queueMock.getJob).toHaveBeenCalledWith(`deletion-${mockTenant.id}`);
            expect(jobMock.remove).toHaveBeenCalled();
        });

        it('should do nothing if job does not exist', async () => {
            const payload = {
                tenant: mockTenant,
                userId: 'user-1'
            };

            queueMock.getJob.mockResolvedValue(null);

            await listener.handleTenantDeletionCancelledEvent(payload);

            expect(queueMock.getJob).toHaveBeenCalledWith(`deletion-${mockTenant.id}`);
            // Should not crash
        });
    });
});
