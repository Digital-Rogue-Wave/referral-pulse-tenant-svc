import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY, ALLOW_NO_TENANT_KEY } from '@app/types';
import type { IAuthenticatedUser } from '@app/types';

/**
 * JWT Authentication Guard.
 * Validates JWT tokens using the JwtStrategy.
 * Routes can be marked as public using @Public() decorator.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    constructor(private reflector: Reflector) {
        super();
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Public routes skip authentication entirely.
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
        if (isPublic) {
            return true;
        }

        // Validate the JWT via JwtStrategy (sets request.user).
        const activated = (await super.canActivate(context)) as boolean;
        if (!activated) {
            return false;
        }

        // Tenant is required on every human route unless explicitly opted out (@AllowNoTenant, e.g.
        // invitation accept). Service tokens are tenant-optional by design (system/cross-tenant callers).
        const allowNoTenant = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_TENANT_KEY, [context.getHandler(), context.getClass()]);
        if (!allowNoTenant) {
            const user = context.switchToHttp().getRequest<{ user?: IAuthenticatedUser }>().user;
            if (user && !user.isServiceToken && !user.tenantId) {
                throw new UnauthorizedException('Tenant context required');
            }
        }

        return true;
    }

    handleRequest<TUser = unknown>(err: Error | undefined, user: TUser | undefined, info: { message?: string } | undefined): TUser {
        // Handle authentication errors
        if (err || !user) {
            const message = info?.message ?? 'Unauthorized';
            throw err ?? new UnauthorizedException(message);
        }

        return user;
    }
}
