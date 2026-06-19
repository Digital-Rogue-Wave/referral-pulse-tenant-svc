import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TenantService } from '@app/features/tenant/tenant.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { ErrorCode } from '@app/types/app.type';
import { BillingGuardOptions, BILLING_GUARD_KEY } from '../decorators/billing-guard.decorator';
import { PlanLimitService } from '../plan-limit.service';

@Injectable()
export class BillingGuard implements CanActivate {
    constructor(
        private readonly tenantService: TenantService,
        private readonly planLimitService: PlanLimitService,
        private readonly tenantContext: TenantContextService,
        private readonly reflector: Reflector
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            return true;
        }

        const tenant = await this.tenantService.findOneById(tenantId);

        if (!tenant) {
            throw new BaseException('tenant_not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
        }

        const options = this.reflector.getAllAndOverride<BillingGuardOptions | undefined>(BILLING_GUARD_KEY, [
            context.getHandler(),
            context.getClass()
        ]);

        if (!options || !options.metrics || options.metrics.length === 0) {
            return true;
        }

        const amount = options.amount && options.amount > 0 ? options.amount : 1;

        for (const metric of options.metrics) {
            await this.planLimitService.enforceLimit(tenantId, metric, amount, {
                gracePercentage: options.gracePercentage
            });
        }

        return true;
    }
}
