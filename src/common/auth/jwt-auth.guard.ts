import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { Observable } from 'rxjs';

import { IS_PUBLIC_KEY } from '@app/types';

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

    canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
        // Check if route is marked as public
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

        if (isPublic) {
            return true;
        }

        // Call parent AuthGuard which uses JwtStrategy
        return super.canActivate(context);
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
