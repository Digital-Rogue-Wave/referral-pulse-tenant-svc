import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY, ALLOW_NO_TENANT_KEY } from '@app/types';
import type { IAuthenticatedUser } from '@app/types';

import { PLATFORM_ADMIN_KEY } from './require-permission.decorator';

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
        // invitation accept). Service tokens are tenant-optional by design (system/cross-tenant callers), and so is a
        // Super Admin's platform token on a platform route (E1 D17): staff never hold a tenant.
        const targets = [context.getHandler(), context.getClass()];
        const allowNoTenant = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_TENANT_KEY, targets);
        if (!allowNoTenant) {
            const user = context.switchToHttp().getRequest<{ user?: IAuthenticatedUser }>().user;
            const isPlatformCall = user?.source === 'platform' && this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, targets) === true;
            if (user && !user.isServiceToken && !user.tenantId && !isPlatformCall) {
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
