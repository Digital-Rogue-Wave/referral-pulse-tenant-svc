import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgnosticTenantService } from './agnostic-tenant.service';
import { TenantEntity } from '../tenant.entity';
import { FilesService } from '@mod/files/files.service';
import { AgnosticTenantSettingService } from '@mod/tenant-setting/agnostic/agnostic-tenant-setting.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubdomainService } from '../dns/subdomain.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { CreateTenantDto } from '../dto/tenant/create-tenant.dto';
import { HttpException, HttpStatus } from '@nestjs/common';
import Stubber from '@mod/common/mock/typeorm-faker';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TenantSettingEntity } from '@mod/tenant-setting/tenant-setting.entity';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';

describe('AgnosticTenantService', () => {
    let service: AgnosticTenantService;
    let tenantRepository: DeepMocked<Repository<TenantEntity>>;
    let filesService: DeepMocked<FilesService>;
    let tenantSettingService: DeepMocked<AgnosticTenantSettingService>;
    let eventEmitter: DeepMocked<EventEmitter2>;
    let subdomainService: DeepMocked<SubdomainService>;
    let ketoService: DeepMocked<KetoService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AgnosticTenantService,
                {
                    provide: getRepositoryToken(TenantEntity),
                    useValue: createMock<Repository<TenantEntity>>()
                },
                {
                    provide: FilesService,
                    useValue: createMock<FilesService>()
                },
                {
                    provide: AgnosticTenantSettingService,
                    useValue: createMock<AgnosticTenantSettingService>()
                },
                {
                    provide: EventEmitter2,
                    useValue: createMock<EventEmitter2>()
                },
                {
                    provide: SubdomainService,
                    useValue: createMock<SubdomainService>()
                },
                {
                    provide: KetoService,
                    useValue: createMock<KetoService>()
                }
            ]
        }).compile();

        service = module.get<AgnosticTenantService>(AgnosticTenantService);
        tenantRepository = module.get(getRepositoryToken(TenantEntity));
        filesService = module.get(FilesService);
        tenantSettingService = module.get(AgnosticTenantSettingService);
        eventEmitter = module.get(EventEmitter2);
        subdomainService = module.get(SubdomainService);
        ketoService = module.get(KetoService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        const createTenantDto: CreateTenantDto = {
            name: 'Test Tenant',
            slug: 'test-tenant',
            ownerId: 'owner-123'
        };

        it('should create a tenant successfully', async () => {
            const tenantStub = Stubber.stubOne(TenantEntity, {
                id: 'tenant-123',
                name: createTenantDto.name,
                slug: createTenantDto.slug
            });

            subdomainService.validateSubdomain.mockReturnValue(undefined);
            subdomainService.isSubdomainAvailable.mockResolvedValue(true);
            tenantRepository.create.mockReturnValue(tenantStub);
            tenantRepository.save.mockResolvedValue(tenantStub);
            tenantSettingService.createDefault.mockResolvedValue(createMock<TenantSettingEntity>());
            ketoService.createTuple.mockResolvedValue(undefined);

            const result = await service.create(createTenantDto);

            expect(result).toEqual(tenantStub);
            expect(subdomainService.validateSubdomain).toHaveBeenCalledWith(createTenantDto.slug!);
            expect(subdomainService.isSubdomainAvailable).toHaveBeenCalledWith(createTenantDto.slug!);
            expect(tenantRepository.create).toHaveBeenCalled();
            expect(tenantRepository.save).toHaveBeenCalled();
            expect(tenantSettingService.createDefault).toHaveBeenCalledWith(tenantStub);
            expect(ketoService.createTuple).toHaveBeenCalledTimes(2);
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.created', {
                tenant: tenantStub,
                ownerId: createTenantDto.ownerId
            });
        });

        it('should throw error if subdomain is not available', async () => {
            subdomainService.validateSubdomain.mockReturnValue(undefined);
            subdomainService.isSubdomainAvailable.mockResolvedValue(false);

            await expect(service.create(createTenantDto)).rejects.toThrow(HttpException);
            await expect(service.create(createTenantDto)).rejects.toMatchObject({
                status: HttpStatus.CONFLICT
            });
        });

        it('should handle file upload if provided', async () => {
            const tenantStub = Stubber.stubOne(TenantEntity, {
                id: 'tenant-123',
                name: createTenantDto.name,
                slug: createTenantDto.slug
            });
            const file = { buffer: Buffer.from('test') } as any;

            subdomainService.validateSubdomain.mockReturnValue(undefined);
            subdomainService.isSubdomainAvailable.mockResolvedValue(true);
            tenantRepository.create.mockReturnValue(tenantStub);
            tenantRepository.save.mockResolvedValue(tenantStub);
            filesService.uploadFile.mockResolvedValue({ id: 'file-123', path: 'image-url' } as any);

            await service.create(createTenantDto, file);

            expect(filesService.uploadFile).toHaveBeenCalledWith(file);
            expect(tenantStub.image).toMatchObject({ path: 'image-url' });
        });
    });

    describe('suspend', () => {
        it('should suspend a tenant successfully', async () => {
            const tenant = Stubber.stubOne(TenantEntity, { id: 'tenant-1', status: TenantStatusEnum.ACTIVE });
            tenantRepository.findOne.mockResolvedValue(tenant);
            tenantRepository.save.mockResolvedValue(Stubber.stubOne(TenantEntity, { ...tenant, status: TenantStatusEnum.SUSPENDED }));

            const result = await service.suspend('tenant-1', 'test reason');

            expect(result.status).toBe(TenantStatusEnum.SUSPENDED);
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.suspended', {
                tenantId: 'tenant-1',
                reason: 'test reason'
            });
        });

        it('should throw if tenant not found', async () => {
            tenantRepository.findOne.mockResolvedValue(null);
            await expect(service.suspend('non-existent')).rejects.toThrow(HttpException);
        });
    });

    describe('unsuspend', () => {
        it('should unsuspend a tenant successfully', async () => {
            const tenant = Stubber.stubOne(TenantEntity, { id: 'tenant-1', status: TenantStatusEnum.SUSPENDED });
            tenantRepository.findOne.mockResolvedValue(tenant);
            tenantRepository.save.mockResolvedValue(Stubber.stubOne(TenantEntity, { ...tenant, status: TenantStatusEnum.ACTIVE }));

            const result = await service.unsuspend('tenant-1');

            expect(result.status).toBe(TenantStatusEnum.ACTIVE);
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.unsuspended', {
                tenantId: 'tenant-1'
            });
        });
    });
});
