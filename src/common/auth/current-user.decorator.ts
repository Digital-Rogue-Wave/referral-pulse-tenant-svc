import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@mod/types/app.interface';

export type CurrentUserType = {
    id: string;
    email: string;
    identityId: string;
    sub: string;
};

export function getCurrentUser(request: { user: JwtPayload }): CurrentUserType {
    const user = request.user;

    return {
        id: user.sub,
        email: user.email,
        identityId: user.sub,
        sub: user.sub
    };
}

export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return getCurrentUser(request);
});
