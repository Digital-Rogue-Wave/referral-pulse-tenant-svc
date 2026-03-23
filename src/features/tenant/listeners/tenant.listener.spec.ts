import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { SnsPublisherService } from '@common/messaging/sns-publisher.service';
import { KetoService } from '@common/auth/keto.service';
import { HttpClientService } from '@common/http/http-client.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { BullJobsService } from '@common/bulljobs';
import { DomainProvisioningService } from '../../dns/domain-provisioning.service';

import { TenantListener } from './tenant.listener';
import {
    TenantCreatedEvent,
    TenantDeletionScheduledEvent,
    TenantDeletionCancelledEvent,
} from '@domains/tenant/events/tenant.events';

describe('TenantListener', () => {
    let listener: TenantListener;
    let bullJobsService: MockProxy<BullJobsService>;
    let snsPublisher: MockProxy<SnsPublisherService>;
    let ketoService: MockProxy<KetoService>;
    let httpClient: MockProxy<HttpClientService>;
    let configService: MockProxy<ConfigService>;
    let domainProvisioningService: MockProxy<DomainProvisioningService>;
    let logger: MockProxy<AppLoggerService>;

    const tenantId = 'tenant-123';

    beforeEach(async () => {
        bullJobsService = mock<BullJobsService>();
        snsPublisher = mock<SnsPublisherService>();
        ketoService = mock<KetoService>();
        httpClient = mock<HttpClientService>();
        configService = mock<ConfigService>();
        domainProvisioningService = mock<DomainProvisioningService>();
        logger = mock<AppLoggerService>();

        configService.getOrThrow.mockReturnValue({
            keto: {
                writeUrl: 'http://keto-write',
                readUrl: 'http://keto-read',
            },
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantListener,
                { provide: SnsPublisherService, useValue: snsPublisher },
                { provide: KetoService, useValue: ketoService },
                { provide: BullJobsService, useValue: bullJobsService },
                { provide: HttpClientService, useValue: httpClient },
                { provide: ConfigService, useValue: configService },
                {
                    provide: DomainProvisioningService,
                    useValue: domainProvisioningService,
                },
                { provide: AppLoggerService, useValue: logger },
            ],
        }).compile();

        listener = module.get<TenantListener>(TenantListener);
    });

    it('should be defined', () => {
        expect(listener).toBeDefined();
    });

    describe('handleTenantCreatedEvent', () => {
        it('should publish SNS event on tenant creation', async () => {
            const event = new TenantCreatedEvent(
                tenantId,
                tenantId,
                'Test Tenant',
                'test-tenant',
                'owner-123',
                new Date(),
                new Date(),
                'user-123',
            );

            await listener.handleTenantCreatedEvent(event);

            expect(snsPublisher.publish).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType: 'tenant.created',
                    data: expect.objectContaining({
                        tenantId,
                        name: 'Test Tenant',
                        slug: 'test-tenant',
                    }),
                }),
                expect.objectContaining({
                    topic: 'tenant-events',
                    groupId: tenantId,
                }),
            );
        });
    });

    describe('handleTenantDeletionScheduledEvent', () => {
        it('should schedule a deletion job', async () => {
            const scheduledAt = new Date();
            const executionDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
            const event = new TenantDeletionScheduledEvent(
                tenantId,
                tenantId,
                scheduledAt,
                executionDate,
                'Test reason',
                'user-123',
            );

            await listener.handleTenantDeletionScheduledEvent(event);

            expect(snsPublisher.publish).toHaveBeenCalled();
            expect(bullJobsService.addDelayedJob).toHaveBeenCalledWith(
                expect.any(String),
                'execute-deletion',
                expect.objectContaining({
                    tenantId,
                    reason: 'Test reason',
                }),
                expect.any(Number),
                expect.objectContaining({
                    jobId: `deletion-${tenantId}`,
                }),
            );
        });
    });

    describe('handleTenantDeletionCancelledEvent', () => {
        it('should remove the deletion job', async () => {
            const event = new TenantDeletionCancelledEvent(tenantId, tenantId, new Date(), 'user-123');

            await listener.handleTenantDeletionCancelledEvent(event);

            expect(snsPublisher.publish).toHaveBeenCalled();
            expect(bullJobsService.removeJob).toHaveBeenCalledWith(expect.any(String), `deletion-${tenantId}`);
        });
    });
});
