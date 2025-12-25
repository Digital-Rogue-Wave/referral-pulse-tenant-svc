import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import { AgnosticTenantService } from '../agnostic/agnostic-tenant.service';
import { Request } from 'express';

@Injectable()
export class TenantLockGuard implements CanActivate {
    constructor(
        private readonly tenantService: AgnosticTenantService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();

        // Try to get tenantId from params, then from CLS context
        const tenantId = request.params.id || request.params.tenantId || this.cls.get('tenantId');
        if (!tenantId) {
            return true;
        }

        const tenant = await this.tenantService.findOne(tenantId);

        if (!tenant) {
            throw new HttpException({ message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
        }

        if (tenant.status === TenantStatusEnum.LOCKED) {
            throw new HttpException(
                {
                    message: 'This account has been locked. Please unlock it using your password.',
                    code: 'TENANT_LOCKED',
                    lockedAt: tenant.lockedAt,
                    lockUntil: tenant.lockUntil,
                    reason: tenant.lockReason
                },
                HttpStatus.FORBIDDEN
            );
        }

        return true;
    }
}
