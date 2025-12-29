import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import { AgnosticTenantService } from '@mod/tenant/agnostic/agnostic-tenant.service';
import { PaymentStatusEnum } from '@mod/common/enums/billing.enum';

@Injectable()
export class PaymentRequiredGuard implements CanActivate {
    constructor(
        private readonly tenantService: AgnosticTenantService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();

        const tenantId = request.params.tenantId || request.params.id || this.cls.get('tenantId');

        if (!tenantId) {
            return true;
        }

        const tenant = await this.tenantService.findOne(tenantId);

        if (!tenant) {
            throw new HttpException({ message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
        }

        if (tenant.paymentStatus === PaymentStatusEnum.FAILED) {
            throw new HttpException(
                {
                    message: 'Payment is required to access this resource.',
                    code: 'PAYMENT_REQUIRED'
                },
                HttpStatus.PAYMENT_REQUIRED
            );
        }

        return true;
    }
}
