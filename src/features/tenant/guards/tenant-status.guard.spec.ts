import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { TenantStatusGuard } from './tenant-status.guard';
import { TenantService } from '../tenant.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TenantStatus } from '@domains/tenant/tenant.types';

describe('TenantStatusGuard', () => {
    let guard: TenantStatusGuard;
    let tenantService: MockProxy<TenantService>;
    let tenantContext: MockProxy<TenantContextService>;

    const createMockExecutionContext = (params: Record<string, string> = {}): ExecutionContext => {
        return {
            switchToHttp: () => ({
                getRequest: () => ({
                    params
                })
            })
        } as ExecutionContext;
    };

    beforeEach(async () => {
        tenantService = mock<TenantService>();
        tenantContext = mock<TenantContextService>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantStatusGuard,
                { provide: TenantService, useValue: tenantService },
                { provide: TenantContextService, useValue: tenantContext }
            ]
        }).compile();

        guard = module.get<TenantStatusGuard>(TenantStatusGuard);
    });

    it('should be defined', () => {
        expect(guard).toBeDefined();
    });

    it('should allow access if no tenantId available', async () => {
        tenantContext.getTenantId.mockReturnValue(undefined);
        const context = createMockExecutionContext();

        const result = await guard.canActivate(context);

        expect(result).toBe(true);
    });

    it('should allow access if tenant is ACTIVE', async () => {
        tenantContext.getTenantId.mockReturnValue('tenant-123');
        tenantService.findOneById.mockResolvedValue({
            id: 'tenant-123',
            status: TenantStatus.ACTIVE
        } as any);

        const context = createMockExecutionContext();
        const result = await guard.canActivate(context);

        expect(result).toBe(true);
    });

    it('should resolve tenantId from the tenant context (ignoring route params)', async () => {
        tenantContext.getTenantId.mockReturnValue('context-tenant');
        tenantService.findOneById.mockResolvedValue({
            id: 'context-tenant',
            status: TenantStatus.ACTIVE
        } as any);

        const context = createMockExecutionContext({ id: 'param-tenant' });
        await guard.canActivate(context);

        expect(tenantService.findOneById).toHaveBeenCalledWith('context-tenant');
    });

    it('should throw FORBIDDEN if tenant is SUSPENDED', async () => {
        tenantContext.getTenantId.mockReturnValue('tenant-123');
        tenantService.findOneById.mockResolvedValue({
            id: 'tenant-123',
            status: TenantStatus.SUSPENDED
        } as any);

        const context = createMockExecutionContext();

        await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

        try {
            await guard.canActivate(context);
        } catch (e: any) {
            expect(e.getStatus()).toBe(HttpStatus.FORBIDDEN);
            expect(e.getResponse().errorCode).toBe('TENANT_SUSPENDED');
        }
    });

    it('should throw FORBIDDEN if tenant is LOCKED', async () => {
        tenantContext.getTenantId.mockReturnValue('tenant-123');
        tenantService.findOneById.mockResolvedValue({
            id: 'tenant-123',
            status: TenantStatus.LOCKED
        } as any);

        const context = createMockExecutionContext();

        await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

        try {
            await guard.canActivate(context);
        } catch (e: any) {
            expect(e.getStatus()).toBe(HttpStatus.FORBIDDEN);
            expect(e.getResponse().errorCode).toBe('TENANT_LOCKED');
        }
    });

    it('should throw NOT_FOUND if tenant does not exist', async () => {
        tenantContext.getTenantId.mockReturnValue('non-existent');
        tenantService.findOneById.mockResolvedValue(null);

        const context = createMockExecutionContext();

        await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

        try {
            await guard.canActivate(context);
        } catch (e: any) {
            expect(e.getStatus()).toBe(HttpStatus.NOT_FOUND);
            expect(e.getResponse().errorCode).toBe('TENANT_NOT_FOUND');
        }
    });
});
