import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AgnosticTenantController } from './agnostic-tenant.controller';
import { AgnosticTenantService } from './agnostic-tenant.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TenantEntity } from '../tenant.entity';
import { FilesService } from '@mod/files/files.service';
import { AgnosticTenantSettingService } from '@mod/tenant-setting/agnostic/agnostic-tenant-setting.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubdomainService } from '../../dns/subdomain.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard } from '@mod/common/auth/keto.guard';
import { AutomapperModule } from '@automapper/nestjs';
import { classes } from '@automapper/classes';
import { TenantSerializationProfile } from '../serialization/tenant-serialization.profile';
import { Repository } from 'typeorm';

import { createMock, DeepMocked } from '@golevelup/ts-jest';
import Stubber from '@mod/common/mock/typeorm-faker';

describe('Tenant Registration Integration', () => {
    let app: INestApplication;
    let tenantRepository: DeepMocked<Repository<TenantEntity>>;
    let subdomainService: DeepMocked<SubdomainService>;
    let ketoService: DeepMocked<KetoService>;
    let filesService: DeepMocked<FilesService>;
    let tenantSettingService: DeepMocked<AgnosticTenantSettingService>;
    let eventEmitter: DeepMocked<EventEmitter2>;

    beforeEach(async () => {
        tenantRepository = createMock<Repository<TenantEntity>>();
        subdomainService = createMock<SubdomainService>();
        ketoService = createMock<KetoService>();
        filesService = createMock<FilesService>();
        tenantSettingService = createMock<AgnosticTenantSettingService>();
        eventEmitter = createMock<EventEmitter2>();

        // Setup some default behaviors for the mocks
        tenantRepository.create.mockImplementation((dto: any) => Stubber.stubOne(TenantEntity, dto));
        tenantRepository.save.mockImplementation((entity: any) => {
            if (!entity.id) entity.id = 'new-id';
            return Promise.resolve(entity);
        });
        subdomainService.validateSubdomain.mockReturnValue(undefined);
        subdomainService.isSubdomainAvailable.mockResolvedValue(true);
        ketoService.createTuple.mockResolvedValue(undefined);
        filesService.uploadFile.mockResolvedValue({ id: 'f1', path: 'url' } as any);
        tenantSettingService.createDefault.mockResolvedValue({} as any);

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                AutomapperModule.forRoot({
                    strategyInitializer: classes()
                })
            ],
            controllers: [AgnosticTenantController],
            providers: [
                AgnosticTenantService,
                TenantSerializationProfile,
                {
                    provide: getRepositoryToken(TenantEntity),
                    useValue: tenantRepository
                },
                {
                    provide: SubdomainService,
                    useValue: subdomainService
                },
                {
                    provide: KetoService,
                    useValue: ketoService
                },
                {
                    provide: FilesService,
                    useValue: filesService
                },
                {
                    provide: AgnosticTenantSettingService,
                    useValue: tenantSettingService
                },
                {
                    provide: EventEmitter2,
                    useValue: eventEmitter
                }
            ]
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({
                canActivate: (context: any) => {
                    const req = context.switchToHttp().getRequest();
                    req.user = { sub: 'user-123', email: 'test@example.com' };
                    return true;
                }
            })
            .overrideGuard(KetoGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleFixture.createNestApplication();
        app.use((req: any, res: any, next: any) => {
            req.user = { sub: 'user-123', email: 'test@example.com' };
            next();
        });
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        app.enableVersioning();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
        jest.clearAllMocks();
    });

    it('POST /v1/tenants should create a tenant', async () => {
        const payload = {
            name: 'Integration Tenant',
            slug: 'integration-slug'
        };

        const response = await request(app.getHttpServer()).post('/v1/tenants').field('data', JSON.stringify(payload));

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
            name: payload.name,
            slug: payload.slug
        });

        expect(tenantRepository.create).toHaveBeenCalled();
        expect(tenantRepository.save).toHaveBeenCalled();
        expect(ketoService.createTuple).toHaveBeenCalled();
        expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.created', expect.any(Object));
    });
});
