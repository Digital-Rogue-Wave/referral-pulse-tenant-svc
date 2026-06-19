import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TenantService } from '@app/features/tenant/tenant.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { ErrorCode } from '@app/types/app.type';
import { PaymentStatusEnum } from '@common/enums/billing.enum';

@Injectable()
export class PaymentRequiredGuard implements CanActivate {
    constructor(
        private readonly tenantService: TenantService,
        private readonly tenantContext: TenantContextService
    ) {}

    async canActivate(_context: ExecutionContext): Promise<boolean> {
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            return true;
        }

        const tenant = await this.tenantService.findOneById(tenantId);

        if (!tenant) {
            throw new BaseException('tenant_not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
        }

        if (tenant.paymentStatus === PaymentStatusEnum.LOCKED) {
            throw new BaseException('payment_required', 'Payment is required to access this resource.', HttpStatus.PAYMENT_REQUIRED);
        }

        return true;
    }
}
