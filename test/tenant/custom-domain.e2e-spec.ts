import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType, HttpStatus, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { register } from 'prom-client';
import { ConfigService } from '@nestjs/config';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { AwareTenantService } from '@mod/tenant/aware/aware-tenant.service';
import { AwareTenantController } from '@mod/tenant/aware/aware-tenant.controller';
import { DnsVerificationService } from '@mod/dns/dns-verification.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { DomainVerificationStatusEnum } from '@mod/common/enums/tenant.enum';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { ClsModule } from 'nestjs-cls';
import { AutomapperModule } from '@automapper/nestjs';
import { classes } from '@automapper/classes';
import { TenantSerializationProfile } from '@mod/tenant/serialization/tenant-serialization.profile';
import { FilesService } from '@mod/files/files.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KratosService } from '@mod/common/auth/kratos.service';
import { SubdomainService } from '@mod/dns/subdomain.service';
import { TenantStatsService } from '@mod/tenant/aware/tenant-stats.service';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard } from '@mod/common/auth/keto.guard';
import { getQueueToken } from '@nestjs/bullmq';
import { TENANT_UNLOCK_QUEUE } from '@mod/common/bullmq/queues/tenant-unlock.queue';
import { AuditService } from '@mod/common/audit/audit.service';

describe('Custom Domain (Integration)', () => {
    let app: INestApplication;
    let dnsVerificationService: DeepMocked<DnsVerificationService>;
    let tenantRepository: any;

    const mockTenant = {
        id: 'tenant-123',
        name: 'Test Tenant',
        slug: 'test-tenant',
        customDomain: 'example.com',
        domainVerificationToken: 'pulse-verification-123',
        domainVerificationStatus: DomainVerificationStatusEnum.PENDING
    } as any as TenantEntity;

    const mockUser = { id: 'user-123', email: 'test@example.com', sub: 'user-123' };

    class MockGuard implements CanActivate {
        canActivate(context: ExecutionContext): boolean {
            const req = context.switchToHttp().getRequest();
            req.user = mockUser;
            return true;
        }
    }

    beforeEach(async () => {
        register.clear();
        dnsVerificationService = createMock<DnsVerificationService>();

        tenantRepository = createMock();
        tenantRepository.findOneOrFailTenantContext = jest.fn().mockResolvedValue(mockTenant);
        tenantRepository.save = jest.fn().mockResolvedValue(mockTenant);

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [ClsModule.forRoot({ global: true }), AutomapperModule.forRoot({ strategyInitializer: classes() })],
            controllers: [AwareTenantController],
            providers: [
                AwareTenantService,
                TenantSerializationProfile,
                { provide: 'TenantAwareRepository_TenantEntity', useValue: tenantRepository },
                { provide: DnsVerificationService, useValue: dnsVerificationService },
                { provide: KetoService, useValue: createMock<KetoService>() },
                { provide: ConfigService, useValue: createMock<ConfigService>() },
                { provide: FilesService, useValue: createMock<FilesService>() },
                { provide: EventEmitter2, useValue: createMock<EventEmitter2>() },
                { provide: KratosService, useValue: createMock<KratosService>() },
                { provide: SubdomainService, useValue: createMock<SubdomainService>() },
                { provide: TenantStatsService, useValue: createMock<TenantStatsService>() },
                { provide: getQueueToken(TENANT_UNLOCK_QUEUE), useValue: createMock() },
                { provide: AuditService, useValue: createMock<AuditService>() }
            ]
        })
            .overrideGuard(JwtAuthGuard)
            .useClass(MockGuard)
            .overrideGuard(KetoGuard)
            .useClass(MockGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api');
        app.enableVersioning({ type: VersioningType.URI });

        await app.init();
    });

    afterEach(async () => {
        if (app) {
            await app.close();
        }
    });

    describe('GET /api/v1/tenants/:id/custom-domain/status', () => {
        it('should return current domain status', async () => {
            const response = await request(app.getHttpServer())
                .get('/api/v1/tenants/tenant-123/custom-domain/status')
                .set('tenant-id', 'tenant-123')
                .expect(HttpStatus.OK);

            expect(response.body).toEqual({
                customDomain: mockTenant.customDomain,
                domainVerificationStatus: mockTenant.domainVerificationStatus,
                domainVerificationToken: mockTenant.domainVerificationToken
            });
        });
    });

    describe('POST /api/v1/tenants/:id/custom-domain/verify', () => {
        it('should verify domain successfully if TXT record matches', async () => {
            dnsVerificationService.verifyTxtRecord.mockResolvedValue(true);

            await request(app.getHttpServer())
                .post('/api/v1/tenants/tenant-123/custom-domain/verify')
                .set('tenant-id', 'tenant-123')
                .expect(HttpStatus.OK);

            expect(dnsVerificationService.verifyTxtRecord).toHaveBeenCalledWith(mockTenant.customDomain, mockTenant.domainVerificationToken);
            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    domainVerificationStatus: DomainVerificationStatusEnum.VERIFIED
                })
            );
        });

        it('should return 400 if TXT record verification fails', async () => {
            dnsVerificationService.verifyTxtRecord.mockResolvedValue(false);

            await request(app.getHttpServer())
                .post('/api/v1/tenants/tenant-123/custom-domain/verify')
                .set('tenant-id', 'tenant-123')
                .expect(HttpStatus.BAD_REQUEST);

            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    domainVerificationStatus: DomainVerificationStatusEnum.FAILED
                })
            );
        });
    });
});
