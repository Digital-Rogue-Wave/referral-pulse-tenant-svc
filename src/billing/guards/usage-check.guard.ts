import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import { USAGE_CHECK_KEY, UsageCheckOptions } from '../decorators/usage-check.decorator';
import { PlanLimitService } from '../plan-limit.service';
import { LimitExceededException } from '../exceptions/limit-exceeded.exception';

@Injectable()
export class UsageCheckGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly planLimitService: PlanLimitService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();

        const tenantId = request.tenantId || this.cls.get('tenantId');
        if (!tenantId) {
            return true;
        }

        const options = this.reflector.getAllAndOverride<UsageCheckOptions | undefined>(USAGE_CHECK_KEY, [context.getHandler(), context.getClass()]);

        if (!options) {
            return true;
        }

        const amount = options.amount && options.amount > 0 ? options.amount : 1;

        try {
            await this.planLimitService.enforceLimit(tenantId, options.metric, amount, {
                gracePercentage: options.gracePercentage
            });
        } catch (error) {
            if (error instanceof LimitExceededException) {
                throw error;
            }

            return true;
        }

        return true;
    }
}
