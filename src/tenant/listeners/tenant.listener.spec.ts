import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantListener } from './tenant.listener';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { AuditService } from '@mod/common/audit/audit.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { getQueueToken } from '@nestjs/bullmq';
import { TENANT_DELETION_QUEUE } from '@mod/common/bullmq/queues/tenant-deletion.queue';
import { TenantEntity } from '../tenant.entity';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Queue } from 'bullmq';
import { HttpClient } from '@mod/common/http/http.client';
import { ConfigService } from '@nestjs/config';
import { DomainProvisioningService } from '../dns/domain-provisioning.service';
import Stubber from '@mod/common/mock/typeorm-faker';
import { SesService } from '@mod/common/aws-ses/ses.service';

describe('TenantListener', () => {
    let listener: TenantListener;
    let queue: DeepMocked<Queue>;
    let snsPublisher: DeepMocked<SnsPublisher>;
    let auditService: DeepMocked<AuditService>;
    let ketoService: DeepMocked<KetoService>;
    let httpClient: DeepMocked<HttpClient>;
    let configService: DeepMocked<ConfigService>;
    let domainProvisioningService: DeepMocked<DomainProvisioningService>;
    let sesService: DeepMocked<SesService>;

    const mockTenant = Stubber.stubOne(TenantEntity, {
        id: 'tenant-123',
        name: 'Test Tenant',
        slug: 'test-tenant'
    });

    beforeEach(async () => {
        queue = createMock<Queue>();
        snsPublisher = createMock<SnsPublisher>();
        auditService = createMock<AuditService>();
        ketoService = createMock<KetoService>();
        httpClient = createMock<HttpClient>();
        configService = createMock<ConfigService>();
        domainProvisioningService = createMock<DomainProvisioningService>();
        sesService = createMock<SesService>();

        configService.getOrThrow.mockReturnValue({
            keto: {
                writeUrl: 'http://keto-write',
                readUrl: 'http://keto-read'
            }
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantListener,
                { provide: SnsPublisher, useValue: snsPublisher },
                { provide: AuditService, useValue: auditService },
                { provide: KetoService, useValue: ketoService },
                { provide: getQueueToken(TENANT_DELETION_QUEUE), useValue: queue },
                { provide: HttpClient, useValue: httpClient },
                { provide: ConfigService, useValue: configService },
                { provide: DomainProvisioningService, useValue: domainProvisioningService },
                { provide: SesService, useValue: sesService }
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
                userEmail: 'user@example.com',
                scheduledAt,
                executionDate,
                reason: 'Test reason'
            };

            await listener.handleTenantDeletionScheduledEvent(payload);

            expect(auditService.log).toHaveBeenCalled();
            expect(snsPublisher.publish).toHaveBeenCalled();
            expect(queue.add).toHaveBeenCalledWith(
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
                userId: 'user-1',
                userEmail: 'user@example.com'
            };

            const jobMock = { remove: jest.fn() };
            queue.getJob.mockResolvedValue(jobMock as any);

            await listener.handleTenantDeletionCancelledEvent(payload);

            expect(auditService.log).toHaveBeenCalled();
            expect(snsPublisher.publish).toHaveBeenCalled();
            expect(queue.getJob).toHaveBeenCalledWith(`deletion-${mockTenant.id}`);
            expect(jobMock.remove).toHaveBeenCalled();
        });

        it('should do nothing if job does not exist', async () => {
            const payload = {
                tenant: mockTenant,
                userId: 'user-1',
                userEmail: 'user@example.com'
            };

            queue.getJob.mockResolvedValue(null as any);

            await listener.handleTenantDeletionCancelledEvent(payload);

            expect(queue.getJob).toHaveBeenCalledWith(`deletion-${mockTenant.id}`);
            // Should not crash
        });
    });
});
