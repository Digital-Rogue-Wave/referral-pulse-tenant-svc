import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TenantStatus } from '@domains/tenant/tenant.types';

import { TenantService } from '../tenant.service';

@Injectable()
export class TenantStatusGuard implements CanActivate {
    constructor(
        private readonly tenantService: TenantService,
        private readonly tenantContext: TenantContextService,
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            return true;
        }

        const tenant = await this.tenantService.findOneById(tenantId);

        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        if (tenant.status === TenantStatus.SUSPENDED) {
            throw new HttpException(
                {
                    message: 'This account has been suspended. Please contact support.',
                    errorCode: 'TENANT_SUSPENDED',
                },
                HttpStatus.FORBIDDEN,
            );
        }

        if (tenant.status === TenantStatus.LOCKED) {
            throw new HttpException(
                {
                    message: 'This account has been locked due to security concerns.',
                    errorCode: 'TENANT_LOCKED',
                },
                HttpStatus.FORBIDDEN,
            );
        }

        return true;
    }
}
