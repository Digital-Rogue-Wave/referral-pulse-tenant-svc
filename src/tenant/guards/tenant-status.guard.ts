import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import { AgnosticTenantService } from '../agnostic/agnostic-tenant.service';

@Injectable()
export class TenantStatusGuard implements CanActivate {
    constructor(
        private readonly tenantService: AgnosticTenantService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const tenantId = this.cls.get('tenantId');
        if (!tenantId) {
            return true; // If no tenant context, we can't check status here. Middleware/other guards should handle missing context.
        }

        const tenant = await this.tenantService.findById(tenantId);

        if (!tenant) {
            throw new HttpException({ message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
        }

        if (tenant.status === TenantStatusEnum.SUSPENDED) {
            throw new HttpException(
                { message: 'This account has been suspended. Please contact support.', code: 'TENANT_SUSPENDED' },
                HttpStatus.FORBIDDEN
            );
        }

        if (tenant.status === TenantStatusEnum.LOCKED) {
            throw new HttpException(
                { message: 'This account has been locked due to security concerns.', code: 'TENANT_LOCKED' },
                HttpStatus.FORBIDDEN
            );
        }

        return true;
    }
}
