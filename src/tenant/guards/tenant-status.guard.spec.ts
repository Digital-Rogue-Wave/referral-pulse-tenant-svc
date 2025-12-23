import { Test, TestingModule } from '@nestjs/testing';
import { TenantStatusGuard } from './tenant-status.guard';
import { ClsService } from 'nestjs-cls';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { AgnosticTenantService } from '../agnostic/agnostic-tenant.service';

describe('TenantStatusGuard', () => {
    let guard: TenantStatusGuard;
    let tenantService: DeepMocked<AgnosticTenantService>;
    let cls: DeepMocked<ClsService<any>>;

    beforeEach(async () => {
        tenantService = createMock<AgnosticTenantService>();
        cls = createMock<ClsService<any>>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantStatusGuard,
                {
                    provide: AgnosticTenantService,
                    useValue: tenantService
                },
                {
                    provide: ClsService,
                    useValue: cls
                }
            ]
        }).compile();

        guard = module.get<TenantStatusGuard>(TenantStatusGuard);
    });

    it('should be defined', () => {
        expect(guard).toBeDefined();
    });

    it('should allow access if no tenantId in context', async () => {
        cls.get.mockReturnValue(null);
        const context = createMock<ExecutionContext>();
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
    });

    it('should allow access if tenant is ACTIVE', async () => {
        cls.get.mockReturnValue('tenant-1');
        tenantService.findById.mockResolvedValue({ id: 'tenant-1', status: TenantStatusEnum.ACTIVE } as any);
        const context = createMock<ExecutionContext>();
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
    });

    it('should throw FORBIDDEN if tenant is SUSPENDED', async () => {
        cls.get.mockReturnValue('tenant-1');
        tenantService.findById.mockResolvedValue({ id: 'tenant-1', status: TenantStatusEnum.SUSPENDED } as any);
        const context = createMock<ExecutionContext>();

        await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
        try {
            await guard.canActivate(context);
        } catch (e: any) {
            expect(e.getStatus()).toBe(HttpStatus.FORBIDDEN);
            expect(e.getResponse().code).toBe('TENANT_SUSPENDED');
        }
    });

    it('should throw FORBIDDEN if tenant is LOCKED', async () => {
        cls.get.mockReturnValue('tenant-1');
        tenantService.findById.mockResolvedValue({ id: 'tenant-1', status: TenantStatusEnum.LOCKED } as any);
        const context = createMock<ExecutionContext>();

        await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
        try {
            await guard.canActivate(context);
        } catch (e: any) {
            expect(e.getStatus()).toBe(HttpStatus.FORBIDDEN);
            expect(e.getResponse().code).toBe('TENANT_LOCKED');
        }
    });

    it('should throw NOT_FOUND if tenant not in DB', async () => {
        cls.get.mockReturnValue('non-existent');
        tenantService.findById.mockResolvedValue(null);
        const context = createMock<ExecutionContext>();

        await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
        try {
            await guard.canActivate(context);
        } catch (e: any) {
            expect(e.getStatus()).toBe(HttpStatus.NOT_FOUND);
        }
    });
});
