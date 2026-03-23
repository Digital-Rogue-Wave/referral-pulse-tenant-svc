import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TenantService } from '@app/features/tenant/tenant.service';
import { PaymentStatusEnum } from '@common/enums/billing.enum';

@Injectable()
export class PaymentRequiredGuard implements CanActivate {
    constructor(
        private readonly tenantService: TenantService,
        private readonly tenantContext: TenantContextService,
    ) {}

    async canActivate(_context: ExecutionContext): Promise<boolean> {
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            return true;
        }

        const tenant = await this.tenantService.findOneById(tenantId);

        if (!tenant) {
            throw new HttpException({ message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
        }

        if (tenant.paymentStatus === PaymentStatusEnum.LOCKED) {
            throw new HttpException(
                {
                    message: 'Payment is required to access this resource.',
                    code: 'PAYMENT_REQUIRED',
                },
                HttpStatus.PAYMENT_REQUIRED,
            );
        }

        return true;
    }
}
