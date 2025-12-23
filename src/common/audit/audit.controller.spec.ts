import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { PaginateQuery } from 'nestjs-paginate';
import { KetoService } from '@mod/common/auth/keto.service';
import { ClsService } from 'nestjs-cls';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard } from '@mod/common/auth/keto.guard';
import { Reflector } from '@nestjs/core';

describe('AuditController', () => {
    let controller: AuditController;
    let service: DeepMocked<AuditService>;

    beforeEach(async () => {
        service = createMock<AuditService>();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuditController],
            providers: [
                {
                    provide: AuditService,
                    useValue: service
                },
                {
                    provide: KetoService,
                    useValue: createMock<KetoService>()
                },
                {
                    provide: ClsService,
                    useValue: createMock<ClsService<any>>()
                },
                Reflector
            ]
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(KetoGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<AuditController>(AuditController);
    });

    it('should call service.findAll with tenantId', async () => {
        const tenantId = 'tenant-1';
        const query: PaginateQuery = { path: '/audit-log' };

        service.findAll.mockResolvedValue({ data: [], meta: {}, links: {} } as any);

        await controller.getAuditLogs(tenantId, query);

        expect(service.findAll).toHaveBeenCalledWith(tenantId, query);
    });
});
