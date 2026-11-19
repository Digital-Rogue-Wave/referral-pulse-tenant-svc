import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IAuthenticatedUser } from '@app/types';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { CreateInvitationDto, InvitationResponse } from '@domains/invitation';

import { InvitationService } from './invitation.service';

/**
 * v5.2 API §3.17 `POST /v1/users/invite` (US1.2.3): invite a user by email with a role, `users:manage` checked
 * live. Here rather than in `UsersController` because `InvitationModule` already depends on `UsersModule`.
 * Same behaviour as `POST /v1/invitations`, which stays for the list, resend and revoke routes.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UserInvitationController {
    constructor(private readonly invitationService: InvitationService) {}

    @ApiOperation({ summary: 'Invite a user by email with a role' })
    @ApiBody({ type: CreateInvitationDto })
    @ApiCreatedResponse({ description: 'Invitation created and email queued', type: InvitationResponse })
    @RequirePermission('users:manage')
    @HttpCode(HttpStatus.CREATED)
    @Post('invite')
    async invite(@Body() dto: CreateInvitationDto, @CurrentUser() user: IAuthenticatedUser): Promise<InvitationResponse> {
        return this.invitationService.create(user, dto);
    }
}
