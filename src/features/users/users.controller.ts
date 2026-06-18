import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';

import { UsersService, UserMeResponse } from './users.service';

/**
 * Platform user endpoints (referralai_api_contract).
 * Role assignment (PUT /users/:id/roles in the contract) is served by the existing
 * PUT /team-members/:id, which projects user_roles and emits user.role_changed — see NOTE.md.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get('me')
    @ApiOperation({ summary: 'Get the current user profile, roles and scopes' })
    @ApiOkResponse({ description: 'The authenticated user profile' })
    async getMe(@CurrentUser() user: IAuthenticatedUser): Promise<UserMeResponse> {
        return this.usersService.getMe(user);
    }
}
