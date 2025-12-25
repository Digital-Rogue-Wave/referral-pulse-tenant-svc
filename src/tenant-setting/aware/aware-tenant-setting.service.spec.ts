import { Test, TestingModule } from '@nestjs/testing';
import { AwareTenantSettingService } from './aware-tenant-setting.service';
import { TenantSettingEntity } from '../tenant-setting.entity';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import Stubber from '@mod/common/mock/typeorm-faker';

describe('AwareTenantSettingService', () => {
    let service: AwareTenantSettingService;
    let repository: DeepMocked<TenantAwareRepository<TenantSettingEntity>>;

    const mockSetting = Stubber.stubOne(TenantSettingEntity, {
        id: 'setting-123',
        general: {
            timezone: 'UTC',
            locale: 'en-US'
        },
        branding: {
            primaryColor: '#000000',
            secondaryColor: '#ffffff',
            fontFamily: 'Inter'
        },
        notifications: {
            emailEnabled: true,
            webhookEnabled: false
        }
    });

    beforeEach(async () => {
        repository = createMock<TenantAwareRepository<TenantSettingEntity>>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AwareTenantSettingService,
                {
                    provide: 'TenantAwareRepository_TenantSettingEntity',
                    useValue: repository
                }
            ]
        }).compile();

        service = module.get<AwareTenantSettingService>(AwareTenantSettingService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        it('should create setting with tenant context', async () => {
            const createDto = { currencyCode: 'USD', general: { timezone: 'UTC', locale: 'en-US' } };
            repository.createTenantContext.mockReturnValue(mockSetting);
            repository.saveTenantContext.mockResolvedValue(mockSetting);

            const result = await service.create(createDto);

            expect(repository.createTenantContext).toHaveBeenCalledWith(createDto);
            expect(repository.saveTenantContext).toHaveBeenCalledWith(mockSetting);
            expect(result).toEqual(mockSetting);
        });
    });

    describe('findOne', () => {
        it('should find one setting with tenant context', async () => {
            repository.findOneTenantContext.mockResolvedValue(mockSetting);

            const result = await service.findOne({ id: 'setting-123' });

            expect(repository.findOneTenantContext).toHaveBeenCalledWith({ id: 'setting-123' }, undefined);
            expect(result).toEqual(mockSetting);
        });
    });

    describe('update', () => {
        it('should update setting and return updated entity', async () => {
            const updateDto = { general: { timezone: 'EST', locale: 'en-US' } };
            repository.update.mockResolvedValue({} as any);
            repository.findOneOrFailTenantContext.mockResolvedValue({ ...mockSetting, ...updateDto } as any);

            const result = await service.update('setting-123', updateDto);

            expect(repository.update).toHaveBeenCalledWith('setting-123', updateDto);
            expect(repository.findOneOrFailTenantContext).toHaveBeenCalledWith({ id: 'setting-123' }, undefined);
            expect(result.general.timezone).toBe('EST');
        });
    });

    describe('remove', () => {
        it('should remove setting with tenant context', async () => {
            repository.deleteTenantContext.mockResolvedValue({} as any);

            await service.remove('setting-123');

            expect(repository.deleteTenantContext).toHaveBeenCalledWith({ id: 'setting-123' });
        });
    });
});
