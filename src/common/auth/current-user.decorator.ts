import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { IAuthenticatedUser } from '@app/types';

/**
 * Extract the authenticated user populated by JwtStrategy.validate().
 *
 * Usage:
 *   @Get() handle(@CurrentUser() user: IAuthenticatedUser) { ... }
 *   @Get() handle(@CurrentUser('tenantId') tenantId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
    (data: keyof IAuthenticatedUser | undefined, ctx: ExecutionContext): IAuthenticatedUser | unknown => {
        const request = ctx.switchToHttp().getRequest<{ user?: IAuthenticatedUser }>();
        const user = request.user;

        if (!user) {
            return undefined;
        }

        return data ? user[data] : user;
    },
);
