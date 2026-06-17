import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Request } from 'express';

import type { IAuthenticatedUser, KetoPermission } from '@app/types';
import { IS_PUBLIC_KEY } from '@app/types';

import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { KetoService } from '@common/auth/keto.service';
import { PERMISSIONS_KEY } from '@common/auth/require-permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
    private readonly logger = new Logger(PermissionGuard.name);

    constructor(
        @Inject(Reflector) private readonly reflector: Reflector,
        private readonly keto: KetoService,
        private readonly tenantContext: TenantContextService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const targets = [context.getHandler(), context.getClass()];

        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
        if (isPublic) {
            return true;
        }

        const requiredPermissions = this.reflector.getAllAndOverride<KetoPermission[]>(PERMISSIONS_KEY, targets);

        if (!requiredPermissions || requiredPermissions.length === 0) {
            return true;
        }

        const req = context.switchToHttp().getRequest<Request>();
        const user = req.user as IAuthenticatedUser | undefined;

        if (!user) {
            throw new HttpException({ message: 'No authenticated user', code: HttpStatus.FORBIDDEN }, HttpStatus.FORBIDDEN);
        }

        const tenantId = this.tenantContext.getTenantId() ?? user.tenantId;

        if (!tenantId) {
            throw new HttpException({ message: 'No tenant context available', code: HttpStatus.FORBIDDEN }, HttpStatus.FORBIDDEN);
        }

        for (const permission of requiredPermissions) {
            // M2M service tokens can bypass Keto when explicitly allowed
            if (user.isServiceToken && permission.allowServiceTokens) {
                continue;
            }

            // Resolve the object: explicit object, route param, or default to tenantId
            const object = this.resolveObject(permission, req, tenantId);

            const allowed = await this.keto.check(permission.namespace, object, permission.relation, user.userId);

            if (!allowed) {
                this.logger.warn(`User ${user.userId} denied: ${permission.namespace}:${object}#${permission.relation}`);
                throw new HttpException(
                    {
                        message: `Missing permission: ${permission.namespace}:${object}#${permission.relation}`,
                        code: HttpStatus.FORBIDDEN
                    },
                    HttpStatus.FORBIDDEN
                );
            }
        }

        return true;
    }

    /**
     * Resolve the Keto object for the permission check.
     * Priority: explicit object > route param > tenantId
     */
    private resolveObject(permission: KetoPermission, req: Request, tenantId: string): string {
        if (permission.object) {
            return permission.object;
        }

        if (permission.objectParam) {
            const paramValue = (req.params as Record<string, string>)[permission.objectParam];
            if (paramValue) {
                return paramValue;
            }
        }

        return tenantId;
    }
}
