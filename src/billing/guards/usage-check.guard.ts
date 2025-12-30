import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import { UsageTrackerService } from '../usage-tracker.service';
import { USAGE_CHECK_KEY, UsageCheckOptions } from '../decorators/usage-check.decorator';
import { LimitExceededException } from '../exceptions/limit-exceeded.exception';

@Injectable()
export class UsageCheckGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly usageTracker: UsageTrackerService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();

        const tenantId = request.tenantId || this.cls.get('tenantId');
        if (!tenantId) {
            return true;
        }

        const options = this.reflector.getAllAndOverride<UsageCheckOptions | undefined>(USAGE_CHECK_KEY, [
            context.getHandler(),
            context.getClass()
        ]);

        if (!options) {
            return true;
        }

        const amount = options.amount && options.amount > 0 ? options.amount : 1;

        let current = 0;
        try {
            current = await this.usageTracker.getUsage(options.metric);
        } catch {
            return true;
        }

        const nextValue = current + amount;

        if (nextValue > options.limit) {
            throw new LimitExceededException({
                metric: options.metric,
                currentUsage: current,
                limit: options.limit,
                upgradeSuggestions: [
                    `Upgrade your subscription plan to increase the allowed ${options.metric} limit.`
                ],
                upgradeUrl: null
            });
        }

        return true;
    }
}
