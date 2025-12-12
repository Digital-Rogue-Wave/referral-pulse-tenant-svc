import { Test, TestingModule } from '@nestjs/testing';
import { TenantService } from './tenant.service';
import { Repository } from 'typeorm';
import { TenantEntity } from './tenant.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FilesService } from '@mod/files/files.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KratosService } from '@mod/common/auth/kratos.service';
import { HttpException } from '@nestjs/common';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';

describe('TenantService - Deletion', () => {
    let service: TenantService;
    let tenantRepository: Repository<TenantEntity>;
    let ketoService: KetoService;
    let kratosService: KratosService;
    let eventEmitter: EventEmitter2;

    const mockTenant: TenantEntity = {
        id: 'tenant-123',
        name: 'Test Tenant',
        slug: 'test-tenant',
        status: TenantStatusEnum.ACTIVE,
        settings: {},
        deletionScheduledAt: undefined,
        deletionReason: undefined
    } as TenantEntity;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantService,
                {
                    provide: getRepositoryToken(TenantEntity),
                    useValue: {
                        findOneOrFail: jest.fn(),
                        save: jest.fn(),
                        delete: jest.fn()
                    }
                },
                {
                    provide: FilesService,
                    useValue: {}
                },
                {
                    provide: KetoService,
                    useValue: {
                        check: jest.fn()
                    }
                },
                {
                    provide: KratosService,
                    useValue: {
                        verifyPassword: jest.fn()
                    }
                },
                {
                    provide: EventEmitter2,
                    useValue: {
                        emit: jest.fn()
                    }
                }
            ]
        }).compile();

        service = module.get<TenantService>(TenantService);
        tenantRepository = module.get<Repository<TenantEntity>>(getRepositoryToken(TenantEntity));
        ketoService = module.get<KetoService>(KetoService);
        kratosService = module.get<KratosService>(KratosService);
        eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    });

    describe('scheduleDeletion', () => {
        it('should schedule deletion successfully', async () => {
            const dto = { password: 'correct-password', reason: 'No longer needed' };
            const userId = 'user-123';
            const identityId = 'identity-123';

            jest.spyOn(ketoService, 'check').mockResolvedValue(true);
            jest.spyOn(kratosService, 'verifyPassword').mockResolvedValue(true);
            jest.spyOn(tenantRepository, 'findOneOrFail').mockResolvedValue(mockTenant);
            jest.spyOn(tenantRepository, 'save').mockResolvedValue({
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED,
                deletionScheduledAt: new Date(),
                deletionReason: dto.reason
            } as TenantEntity);

            const result = await service.scheduleDeletion(mockTenant.id, dto, userId, identityId);

            expect(result).toHaveProperty('scheduledAt');
            expect(result).toHaveProperty('executionDate');
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.deletion.scheduled', expect.any(Object));
        });

        it('should throw error if user lacks permission', async () => {
            const dto = { password: 'correct-password' };
            const userId = 'user-123';
            const identityId = 'identity-123';

            jest.spyOn(ketoService, 'check').mockResolvedValue(false);

            await expect(service.scheduleDeletion(mockTenant.id, dto, userId, identityId)).rejects.toThrow(HttpException);
        });

        it('should throw error if password is invalid', async () => {
            const dto = { password: 'wrong-password' };
            const userId = 'user-123';
            const identityId = 'identity-123';

            jest.spyOn(ketoService, 'check').mockResolvedValue(true);
            jest.spyOn(kratosService, 'verifyPassword').mockResolvedValue(false);

            await expect(service.scheduleDeletion(mockTenant.id, dto, userId, identityId)).rejects.toThrow(HttpException);
        });

        it('should throw error if deletion is already scheduled', async () => {
            const dto = { password: 'correct-password' };
            const userId = 'user-123';
            const identityId = 'identity-123';

            const scheduledTenant = {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED
            };

            jest.spyOn(ketoService, 'check').mockResolvedValue(true);
            jest.spyOn(kratosService, 'verifyPassword').mockResolvedValue(true);
            jest.spyOn(tenantRepository, 'findOneOrFail').mockResolvedValue(scheduledTenant as TenantEntity);

            await expect(service.scheduleDeletion(mockTenant.id, dto, userId, identityId)).rejects.toThrow(HttpException);
        });
    });

    describe('cancelDeletion', () => {
        it('should cancel deletion successfully', async () => {
            const dto = { password: 'correct-password' };
            const userId = 'user-123';
            const identityId = 'identity-123';

            const scheduledTenant = {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED,
                deletionScheduledAt: new Date(),
                deletionReason: 'Test reason'
            };

            jest.spyOn(ketoService, 'check').mockResolvedValue(true);
            jest.spyOn(kratosService, 'verifyPassword').mockResolvedValue(true);
            jest.spyOn(tenantRepository, 'findOneOrFail').mockResolvedValue(scheduledTenant as TenantEntity);
            jest.spyOn(tenantRepository, 'save').mockResolvedValue({
                ...scheduledTenant,
                status: TenantStatusEnum.ACTIVE,
                deletionScheduledAt: undefined,
                deletionReason: undefined
            } as TenantEntity);

            await service.cancelDeletion(mockTenant.id, dto, userId, identityId);

            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.deletion.cancelled', expect.any(Object));
        });

        it('should throw error if deletion is not scheduled', async () => {
            const dto = { password: 'correct-password' };
            const userId = 'user-123';
            const identityId = 'identity-123';

            // Create a fresh mock with ACTIVE status
            const activeTenant = {
                ...mockTenant,
                status: TenantStatusEnum.ACTIVE
            };

            jest.spyOn(ketoService, 'check').mockResolvedValue(true);
            jest.spyOn(kratosService, 'verifyPassword').mockResolvedValue(true);
            jest.spyOn(tenantRepository, 'findOneOrFail').mockResolvedValue(activeTenant as TenantEntity);

            await expect(service.cancelDeletion(mockTenant.id, dto, userId, identityId)).rejects.toThrow(HttpException);
        });
    });

    describe('executeDeletion', () => {
        it('should execute deletion after 30 days', async () => {
            const scheduledDate = new Date();
            scheduledDate.setDate(scheduledDate.getDate() - 31); // 31 days ago

            const scheduledTenant = {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED,
                deletionScheduledAt: scheduledDate
            };

            jest.spyOn(tenantRepository, 'findOneOrFail').mockResolvedValue(scheduledTenant as TenantEntity);
            jest.spyOn(tenantRepository, 'delete').mockResolvedValue({ affected: 1 } as any);

            await service.executeDeletion(mockTenant.id);

            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.deleted', expect.any(Object));
            expect(tenantRepository.delete).toHaveBeenCalledWith(mockTenant.id);
        });

        it('should throw error if 30 days have not passed', async () => {
            const scheduledDate = new Date();
            scheduledDate.setDate(scheduledDate.getDate() - 15); // Only 15 days ago

            const scheduledTenant = {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED,
                deletionScheduledAt: scheduledDate
            };

            jest.spyOn(tenantRepository, 'findOneOrFail').mockResolvedValue(scheduledTenant as TenantEntity);

            await expect(service.executeDeletion(mockTenant.id)).rejects.toThrow(HttpException);
        });

        it('should throw error if tenant is not scheduled for deletion', async () => {
            jest.spyOn(tenantRepository, 'findOneOrFail').mockResolvedValue(mockTenant);

            await expect(service.executeDeletion(mockTenant.id)).rejects.toThrow(HttpException);
        });
    });
});
