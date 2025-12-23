import { FeatureFlagGuard } from './feature-flag.guard';
import { FeatureFlagService } from '../feature-flag.service';
import { Reflector } from '@nestjs/core';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

describe('FeatureFlagGuard', () => {
    let guard: FeatureFlagGuard;
    let service: DeepMocked<FeatureFlagService>;
    let reflector: DeepMocked<Reflector>;
    let cls: DeepMocked<ClsService<any>>;

    beforeEach(() => {
        service = createMock<FeatureFlagService>();
        reflector = createMock<Reflector>();
        cls = createMock<ClsService<any>>();

        guard = new FeatureFlagGuard(reflector, service, cls);
    });

    it('should return true if no feature key is defined', async () => {
        reflector.get.mockReturnValue(null);
        const context = createMock<ExecutionContext>();

        const result = await guard.canActivate(context);
        expect(result).toBe(true);
    });

    it('should throw ForbiddenException if tenantId is missing', async () => {
        reflector.get.mockReturnValue('my-feature');
        const context = createMock<ExecutionContext>({
            switchToHttp: () => ({
                getRequest: () => ({ params: {} })
            })
        });
        cls.get.mockReturnValue(null);

        await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    });

    it('should allow access if feature is enabled', async () => {
        reflector.get.mockReturnValue('my-feature');
        const context = createMock<ExecutionContext>({
            switchToHttp: () => ({
                getRequest: () => ({ params: { id: 'tenant-1' } })
            })
        });
        service.isEnabled.mockResolvedValue(true);

        const result = await guard.canActivate(context);
        expect(result).toBe(true);
        expect(service.isEnabled).toHaveBeenCalledWith('my-feature', 'tenant-1');
    });

    it('should throw ForbiddenException if feature is disabled', async () => {
        reflector.get.mockReturnValue('my-feature');
        const context = createMock<ExecutionContext>({
            switchToHttp: () => ({
                getRequest: () => ({ params: { id: 'tenant-1' } })
            })
        });
        service.isEnabled.mockResolvedValue(false);

        await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    });

    it('should check CLS context for tenantId', async () => {
        reflector.get.mockReturnValue('my-feature');
        const context = createMock<ExecutionContext>({
            switchToHttp: () => ({
                getRequest: () => ({ params: {} })
            })
        });
        cls.get.mockReturnValue('tenant-from-cls');
        service.isEnabled.mockResolvedValue(true);

        const result = await guard.canActivate(context);
        expect(result).toBe(true);
        expect(service.isEnabled).toHaveBeenCalledWith('my-feature', 'tenant-from-cls');
    });
});
