import { describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AwareTenantService } from './aware/aware-tenant.service';
import { TenantEntity } from './tenant.entity';
import { FilesService } from '@mod/files/files.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KratosService } from '@mod/common/auth/kratos.service';
import { HttpException } from '@nestjs/common';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { SubdomainService } from '../dns/subdomain.service';
import { getQueueToken } from '@nestjs/bullmq';
import { TENANT_UNLOCK_QUEUE } from '@mod/common/bullmq/queues/tenant-unlock.queue';
import { AuditService } from '@mod/common/audit/audit.service';

import { TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import Stubber from '@mod/common/mock/typeorm-faker';

describe('AwareTenantService - Deletion', () => {
    let service: AwareTenantService;
    let tenantRepository: DeepMocked<TenantAwareRepository<TenantEntity>>;
    let ketoService: DeepMocked<KetoService>;
    let kratosService: DeepMocked<KratosService>;
    let eventEmitter: DeepMocked<EventEmitter2>;

    const mockTenant = Stubber.stubOne(TenantEntity, {
        id: 'tenant-123',
        name: 'Test Tenant',
        slug: 'test-tenant',
        status: TenantStatusEnum.ACTIVE,
        deletionScheduledAt: undefined,
        deletionReason: undefined
    });

    const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        identityId: 'user-123',
        sub: 'user-123'
    };

    beforeEach(async () => {
        tenantRepository = createMock<TenantAwareRepository<TenantEntity>>();
        ketoService = createMock<KetoService>();
        kratosService = createMock<KratosService>();
        eventEmitter = createMock<EventEmitter2>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AwareTenantService,
                {
                    provide: `TenantAwareRepository_TenantEntity`,
                    useValue: tenantRepository
                },
                {
                    provide: FilesService,
                    useValue: createMock<FilesService>()
                },
                {
                    provide: KetoService,
                    useValue: ketoService
                },
                {
                    provide: KratosService,
                    useValue: kratosService
                },
                {
                    provide: EventEmitter2,
                    useValue: eventEmitter
                },
                {
                    provide: DnsVerificationService,
                    useValue: createMock<DnsVerificationService>()
                },
                {
                    provide: SubdomainService,
                    useValue: createMock<SubdomainService>()
                },
                {
                    provide: getQueueToken(TENANT_UNLOCK_QUEUE),
                    useValue: createMock()
                },
                {
                    provide: AuditService,
                    useValue: createMock<AuditService>()
                }
            ]
        }).compile();

        service = module.get<AwareTenantService>(AwareTenantService);
    });

    describe('scheduleDeletion', () => {
        it('should schedule deletion successfully', async () => {
            const dto = { password: 'correct-password', reason: 'No longer needed' };

            kratosService.verifyPassword.mockResolvedValue(true);
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);
            tenantRepository.save.mockResolvedValue(
                Stubber.stubOne(TenantEntity, {
                    ...mockTenant,
                    status: TenantStatusEnum.DELETION_SCHEDULED,
                    deletionScheduledAt: new Date(),
                    deletionReason: dto.reason
                }) as any
            );

            const result = await service.scheduleDeletion(mockTenant.id, dto, mockUser);

            expect(result).toHaveProperty('scheduledAt');
            expect(result).toHaveProperty('executionDate');
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.deletion.scheduled', expect.any(Object));
        });

        it('should throw error if password is invalid', async () => {
            const dto = { password: 'wrong-password' };

            kratosService.verifyPassword.mockResolvedValue(false);

            await expect(service.scheduleDeletion(mockTenant.id, dto, mockUser)).rejects.toThrow(HttpException);
        });

        it('should throw error if deletion is already scheduled', async () => {
            const dto = { password: 'correct-password' };

            const scheduledTenant = Stubber.stubOne(TenantEntity, {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED
            });

            kratosService.verifyPassword.mockResolvedValue(true);
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(scheduledTenant);

            await expect(service.scheduleDeletion(mockTenant.id, dto, mockUser)).rejects.toThrow(HttpException);
        });
    });

    describe('cancelDeletion', () => {
        it('should cancel deletion successfully', async () => {
            const dto = { password: 'correct-password' };

            const scheduledTenant = Stubber.stubOne(TenantEntity, {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED,
                deletionScheduledAt: new Date(),
                deletionReason: 'Test reason'
            });

            kratosService.verifyPassword.mockResolvedValue(true);
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(scheduledTenant);
            tenantRepository.save.mockResolvedValue(
                Stubber.stubOne(TenantEntity, {
                    ...scheduledTenant,
                    status: TenantStatusEnum.ACTIVE,
                    deletionScheduledAt: undefined,
                    deletionReason: undefined
                }) as any
            );

            await service.cancelDeletion(mockTenant.id, dto, mockUser);

            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.deletion.cancelled', expect.any(Object));
        });

        it('should throw error if deletion is not scheduled', async () => {
            const dto = { password: 'correct-password' };

            // Create a fresh mock with ACTIVE status
            const activeTenant = Stubber.stubOne(TenantEntity, {
                ...mockTenant,
                status: TenantStatusEnum.ACTIVE
            });

            kratosService.verifyPassword.mockResolvedValue(true);
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(activeTenant);

            await expect(service.cancelDeletion(mockTenant.id, dto, mockUser)).rejects.toThrow(HttpException);
        });
    });

    describe('executeDeletion', () => {
        it('should execute deletion after 30 days', async () => {
            const scheduledDate = new Date();
            scheduledDate.setDate(scheduledDate.getDate() - 31); // 31 days ago

            const scheduledTenant = Stubber.stubOne(TenantEntity, {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED,
                deletionScheduledAt: scheduledDate
            });

            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(scheduledTenant);
            tenantRepository.delete.mockResolvedValue({ affected: 1 } as any);

            await service.executeDeletion(mockTenant.id);

            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.deleted', expect.any(Object));
            expect(tenantRepository.delete).toHaveBeenCalledWith(mockTenant.id);
        });

        it('should throw error if 30 days have not passed', async () => {
            const scheduledDate = new Date();
            scheduledDate.setDate(scheduledDate.getDate() - 15); // Only 15 days ago

            const scheduledTenant = Stubber.stubOne(TenantEntity, {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED,
                deletionScheduledAt: scheduledDate
            });

            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(scheduledTenant);

            await expect(service.executeDeletion(mockTenant.id)).rejects.toThrow(HttpException);
        });

        it('should throw error if tenant is not scheduled for deletion', async () => {
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);

            await expect(service.executeDeletion(mockTenant.id)).rejects.toThrow(HttpException);
        });
    });
});
