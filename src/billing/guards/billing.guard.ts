import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import type { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import { AgnosticTenantService } from '@mod/tenant/agnostic/agnostic-tenant.service';
import { BillingGuardOptions, BILLING_GUARD_KEY } from '../decorators/billing-guard.decorator';
import { PlanLimitService } from '../plan-limit.service';

@Injectable()
export class BillingGuard implements CanActivate {
    constructor(
        private readonly tenantService: AgnosticTenantService,
        private readonly planLimitService: PlanLimitService,
        private readonly cls: ClsService<ClsRequestContext>,
        private readonly reflector: Reflector
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();

        const tenantId =
            (request as any).tenantId || request.params.tenantId || request.params.id || this.cls.get('tenantId');

        if (!tenantId) {
            return true;
        }

        const tenant = await this.tenantService.findOne(tenantId);

        if (!tenant) {
            throw new HttpException({ message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
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
