import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Request } from 'express';

import type { IAuthenticatedUser } from '@app/types';
import { IS_PUBLIC_KEY } from '@app/types';

import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { AuthorizationService } from './authz/authorization.service';
import type { ServiceCapability } from './authz/keto-tuples';
import { LIVE_CHECK_PERMISSIONS, Permission } from './authz/permission-catalog';
import { PERMISSIONS_KEY, PLATFORM_ADMIN_KEY, SERVICE_CAPABILITIES_KEY } from './require-permission.decorator';

/**
 * Deny-by-default authorization (API Contract v1.3 §2).
 *
 * - API-key principals never reach this service: keys are gated to ingestion/SDK, and tenant-service
 *   exposes neither.
 * - Service (client-credentials) principals pass only routes marked `@AllowServices`, and only with a
 *   live Keto grant for one of the listed capabilities. Humans never pass a route that only lists
 *   service capabilities.
 * - Human principals: `@PlatformAdmin` routes need a live platform grant; `@RequirePermission` routes are
 *   authorized from the JWT `perms` snapshot, except LIVE_CHECK_PERMISSIONS, which re-check Keto.
 * - The tenant is always the one in the verified token — never a header or a route param.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly authorization: AuthorizationService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(PermissionGuard.name);
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const targets = [context.getHandler(), context.getClass()];
        if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
            return true;
        }

        const user = context.switchToHttp().getRequest<Request>().user as IAuthenticatedUser | undefined;
        if (!user) {
            throw this.denied('No authenticated principal');
        }
        if (user.source === 'api_key') {
            throw this.denied('API keys are limited to event ingestion and SDK endpoints');
        }

        const capabilities = this.reflector.getAllAndOverride<ServiceCapability[]>(SERVICE_CAPABILITIES_KEY, targets) ?? [];
        if (user.isServiceToken) {
            return this.authorizeService(user, capabilities);
        }

        if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, targets)) {
            await this.authorizePlatformAdmin(user);
            return true;
        }

        const permissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
        // A route that names service capabilities and nothing for humans is service-to-service only; without
        // this, a dashboard token would sail through for lack of a human permission to check.
        if (capabilities.length > 0 && permissions.length === 0) {
            throw this.denied('This endpoint is reserved for internal services');
        }
        for (const permission of permissions) {
            await this.authorizePermission(user, permission);
        }
        return true;
    }

    private async authorizeService(user: IAuthenticatedUser, capabilities: ServiceCapability[]): Promise<boolean> {
        const clientId = user.clientId ?? user.userId;
        for (const capability of capabilities) {
            if (await this.authorization.serviceHas(clientId, capability)) {
                return true;
            }
        }
        this.logger.warn('Service principal denied', { clientId, capabilities });
        throw this.denied('This service is not authorized to call this endpoint');
    }

    private async authorizePlatformAdmin(user: IAuthenticatedUser): Promise<void> {
        if (user.userId && (await this.authorization.isPlatformAdmin(user.userId))) {
            return;
        }
        this.logger.warn('Platform-admin route denied', { userId: user.userId });
        throw this.denied('Platform administrator access required');
    }

    private async authorizePermission(user: IAuthenticatedUser, permission: Permission): Promise<void> {
        if (!user.userId || !user.tenantId) {
            throw this.denied(`Missing permission: ${permission}`);
        }
        const allowed = LIVE_CHECK_PERMISSIONS.has(permission)
            ? await this.authorization.userHas(user.userId, user.tenantId, permission)
            : (user.perms ?? []).includes(permission);
        if (!allowed) {
            this.logger.warn('Permission denied', { userId: user.userId, tenantId: user.tenantId, permission });
            throw this.denied(`Missing permission: ${permission}`);
        }
    }

    private denied(message: string): BaseException {
        return new BaseException('authorization_error', message, HttpStatus.FORBIDDEN);
    }
}
