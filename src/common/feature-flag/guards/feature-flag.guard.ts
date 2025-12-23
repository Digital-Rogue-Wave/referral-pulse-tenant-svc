import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagService } from '../feature-flag.service';
import { Request } from 'express';
import { FEATURE_FLAG_KEY } from './feature-flag.decorator';
import { ClsService } from 'nestjs-cls';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private featureFlagService: FeatureFlagService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const featureKey = this.reflector.get<string>(FEATURE_FLAG_KEY, context.getHandler());
        if (!featureKey) {
            return true;
        }

        const request = context.switchToHttp().getRequest<Request>();

        // Try to get tenantId from params, then from CLS context
        const tenantId = request.params.id || request.params.tenantId || this.cls.get('tenantId');

        if (!tenantId) {
            throw new HttpException({ message: 'Tenant context required for feature flag check' }, HttpStatus.FORBIDDEN);
        }

        const isEnabled = await this.featureFlagService.isEnabled(featureKey, tenantId);
        if (!isEnabled) {
            throw new HttpException({ message: `Feature "${featureKey}" is not enabled for this tenant.` }, HttpStatus.FORBIDDEN);
        }

        return true;
    }
}
