import { Test, TestingModule } from '@nestjs/testing';
import { AgnosticTenantSettingService } from './agnostic-tenant-setting.service';
import { TenantSettingEntity } from '../tenant-setting.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createMock, DeepMocked } from '@golevelup/ts-jest';

describe('AgnosticTenantSettingService', () => {
    let service: AgnosticTenantSettingService;
    let repository: DeepMocked<Repository<TenantSettingEntity>>;

    beforeEach(async () => {
        repository = createMock<Repository<TenantSettingEntity>>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AgnosticTenantSettingService,
                {
                    provide: getRepositoryToken(TenantSettingEntity),
                    useValue: repository
                }
            ]
        }).compile();

        service = module.get<AgnosticTenantSettingService>(AgnosticTenantSettingService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('createDefault', () => {
        it('should create default settings with general options', async () => {
            const mockTenant = { id: 'tenant-123' } as any;
            repository.save.mockResolvedValue({ id: 'setting-123' } as any);

            await service.createDefault(mockTenant);

            expect(repository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    tenant: mockTenant,
                    general: {
                        timezone: 'UTC',
                        locale: 'en-US'
                    },
                    currency: expect.objectContaining({ code: 'USD' })
                })
            );
        });
    });
});
