import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { AuditAction } from './audit-action.enum';

describe('AuditInterceptor', () => {
    let interceptor: AuditInterceptor;
    let service: DeepMocked<AuditService>;
    let reflector: DeepMocked<Reflector>;
    let cls: DeepMocked<ClsService<any>>;

    beforeEach(() => {
        service = createMock<AuditService>();
        reflector = createMock<Reflector>();
        cls = createMock<ClsService<any>>();

        interceptor = new AuditInterceptor(reflector, service, cls);
    });

    it('should log if action is present', (done) => {
        const action = AuditAction.TENANT_UPDATED;
        reflector.get.mockReturnValue(action);
        cls.get.mockImplementation((key) => {
            if (key === 'tenantId') return 'tenant-1';
            if (key === 'userId') return 'user-1';
            return null;
        });

        const request = {
            method: 'PUT',
            url: '/tenants/tenant-1',
            ip: '127.0.0.1',
            headers: { 'user-agent': 'test' },
            body: { name: 'New Name' },
            params: { id: 'tenant-1' }
        };

        const context = createMock<ExecutionContext>({
            switchToHttp: () => ({
                getRequest: () => request
            }),
            getHandler: () => ({})
        });

        const next = {
            handle: () => of({ success: true })
        } as CallHandler;

        interceptor.intercept(context, next).subscribe({
            next: () => {
                // Wait for async tap
                setImmediate(() => {
                    expect(service.log).toHaveBeenCalledWith(
                        expect.objectContaining({
                            tenantId: 'tenant-1',
                            userId: 'user-1',
                            action: action
                        })
                    );
                    done();
                });
            }
        });
    });

    it('should not log if action is missing', (done) => {
        reflector.get.mockReturnValue(null);
        const context = createMock<ExecutionContext>({
            getHandler: () => ({})
        });
        const next = {
            handle: () => of({ success: true })
        } as CallHandler;

        interceptor.intercept(context, next).subscribe({
            next: () => {
                expect(service.log).not.toHaveBeenCalled();
                done();
            }
        });
    });
});
