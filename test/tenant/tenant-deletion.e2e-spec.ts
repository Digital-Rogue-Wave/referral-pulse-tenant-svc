import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType, HttpStatus, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { register } from 'prom-client';
import { ConfigService } from '@nestjs/config';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { AwareTenantService } from '@mod/tenant/aware/aware-tenant.service';
import { AwareTenantController } from '@mod/tenant/aware/aware-tenant.controller';
import { AgnosticTenantService } from '@mod/tenant/agnostic/agnostic-tenant.service';
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

describe('Tenant Deletion (Integration)', () => {
    let app: INestApplication;
    let awareTenantService: DeepMocked<AwareTenantService>;
    let agnosticTenantService: DeepMocked<AgnosticTenantService>;

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
        awareTenantService = createMock<AwareTenantService>();
        agnosticTenantService = createMock<AgnosticTenantService>();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [ClsModule.forRoot({ global: true }), AutomapperModule.forRoot({ strategyInitializer: classes() })],
            controllers: [AwareTenantController],
            providers: [
                TenantSerializationProfile,
                { provide: AwareTenantService, useValue: awareTenantService },
                { provide: AgnosticTenantService, useValue: agnosticTenantService },
                { provide: 'TenantAwareRepository_TenantEntity', useValue: createMock() },
                { provide: KetoService, useValue: createMock() },
                { provide: ConfigService, useValue: createMock() },
                { provide: FilesService, useValue: createMock() },
                { provide: EventEmitter2, useValue: createMock() },
                { provide: KratosService, useValue: createMock() },
                { provide: SubdomainService, useValue: createMock() },
                { provide: TenantStatsService, useValue: createMock() },
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

    describe('PUT /api/v1/tenants/:id/schedule-deletion', () => {
        it('should schedule deletion successfully', async () => {
            const scheduledAt = new Date();
            const executionDate = new Date();
            executionDate.setDate(executionDate.getDate() + 30);

            awareTenantService.scheduleDeletion.mockResolvedValue({ scheduledAt, executionDate });

            return request(app.getHttpServer())
                .put('/api/v1/tenants/tenant-123/schedule-deletion')
                .set('tenant-id', 'tenant-123')
                .send({ password: 'valid-password', reason: 'leaving' })
                .expect(HttpStatus.OK)
                .expect((res) => {
                    expect(res.body.scheduledAt).toBeDefined();
                    expect(res.body.executionDate).toBeDefined();
                });
        });
    });

    describe('PUT /api/v1/tenants/:id/cancel-deletion', () => {
        it('should cancel deletion successfully', async () => {
            awareTenantService.cancelDeletion.mockResolvedValue(undefined);

            return request(app.getHttpServer())
                .put('/api/v1/tenants/tenant-123/cancel-deletion')
                .set('tenant-id', 'tenant-123')
                .send({ password: 'valid-password' })
                .expect(HttpStatus.OK);
        });
    });
});

import { KetoService } from '@mod/common/auth/keto.service';
