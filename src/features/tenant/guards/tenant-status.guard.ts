import { Injectable, CanActivate, ExecutionContext, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@app/types/app.type';

import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { TenantStatus } from '@domains/tenant/tenant.types';

import { TenantService } from '../tenant.service';

@Injectable()
export class TenantStatusGuard implements CanActivate {
    constructor(
        private readonly tenantService: TenantService,
        private readonly tenantContext: TenantContextService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Guards run BEFORE interceptors, so the ALS tenant context (set by AlsAuthInterceptor)
        // is not yet populated here. Resolve the tenant from the request the same way the
        // interceptor does — user claim (set by the global JwtAuthGuard) → header → request —
        // falling back to ALS for non-HTTP/late contexts.
        const request = context.switchToHttp().getRequest<{
            user?: { tenantId?: string };
            headers?: Record<string, string | string[] | undefined>;
            tenantId?: string;
        }>();
        const headerTenant = request.headers?.['x-tenant-id'];
        const tenantId =
            request.user?.tenantId ??
            (typeof headerTenant === 'string' ? headerTenant : undefined) ??
            request.tenantId ??
            this.tenantContext.getTenantId();

        if (!tenantId) {
            return true;
        }

        const tenant = await this.tenantService.findOneById(tenantId);

        if (!tenant) {
            throw new BaseException('TENANT_NOT_FOUND' as ErrorCode, 'Tenant not found', HttpStatus.NOT_FOUND);
        }

        if (tenant.status === TenantStatus.SUSPENDED) {
            throw new BaseException(
                'TENANT_SUSPENDED' as ErrorCode,
                'This account has been suspended. Please contact support.',
                HttpStatus.FORBIDDEN
            );
        }

        if (tenant.status === TenantStatus.LOCKED) {
            throw new BaseException('TENANT_LOCKED' as ErrorCode, 'This account has been locked due to security concerns.', HttpStatus.FORBIDDEN);
        }

        return true;
    }
}
