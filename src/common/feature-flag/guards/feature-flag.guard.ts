import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagService } from '../feature-flag.service';
import { Request } from 'express';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private featureFlagService: FeatureFlagService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const featureKey = this.reflector.get<string>('feature_flag_key', context.getHandler());
        if (!featureKey) {
            return true;
        }

        const request = context.switchToHttp().getRequest<Request>();
        const tenantId = request.params.id || request.params.tenantId;

        if (!tenantId) {
            // If we can't identify the tenant, we assume the feature check fails or implies we need a tenant context.
            throw new ForbiddenException('Tenant ID missing for feature flag check');
        }

        const isEnabled = await this.featureFlagService.isEnabled(featureKey, tenantId);
        if (!isEnabled) {
            throw new ForbiddenException(`Feature "${featureKey}" is not enabled for this tenant.`);
        }

        return true;
    }
}
