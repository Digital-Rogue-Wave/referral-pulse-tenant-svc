import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { Public } from '@common/auth/public.decorator';
import { AllowNoTenant } from '@common/auth/allow-no-tenant.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';

import { CreateInvitationDto, InvitationResponse, PublicInvitationResponse } from '@domains/invitation';
import { UserResponse } from '@domains/user';

import { InvitationService } from './invitation.service';

/**
 * Tenant member invitations (tenant-aware, Keto-guarded). Sanctioned extension — not in the
 * canonical API contract (see NOTE.md). Acceptance lives on the public controller below.
 */
@ApiTags('Invitations')
@ApiBearerAuth()
@Controller({ path: 'invitations', version: '1' })
export class InvitationController {
    constructor(private readonly invitationService: InvitationService) {}

    @ApiBody({ type: CreateInvitationDto })
    @ApiCreatedResponse({ description: 'Invitation created and email queued', type: InvitationResponse })
    @RequirePermission('users:write')
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(@Body() dto: CreateInvitationDto, @CurrentUser() user: IAuthenticatedUser): Promise<InvitationResponse> {
        return this.invitationService.create(user, dto);
    }

    @ApiOkResponse({ description: 'A page of tenant invitations, newest first', type: CursorPage })
    @RequirePermission('users:read')
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Query() query: ListQueryDto): Promise<CursorPage<InvitationResponse>> {
        return this.invitationService.findAll(query);
    }

    @ApiOkResponse({ description: 'Invitation re-issued with a fresh token', type: InvitationResponse })
    @RequirePermission('users:write')
    @HttpCode(HttpStatus.OK)
    @Post(':id/resend')
    async resend(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<InvitationResponse> {
        return this.invitationService.resend(id, user.userId);
    }

    @ApiOkResponse({ description: 'Invitation revoked' })
    @RequirePermission('users:write')
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    async revoke(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        await this.invitationService.revoke(id, user.userId);
    }
}

/**
 * Public invitation endpoints. Token validation is fully public; acceptance requires the invitee's
 * own authenticated Ory identity (their email must match the invitation).
 */
@ApiTags('Public - Invitations')
@Controller({ path: 'invitations/public', version: '1' })
export class PublicInvitationController {
    constructor(private readonly invitationService: InvitationService) {}

    @Public()
    @ApiOperation({ summary: 'Validate an invitation token' })
    @ApiOkResponse({ description: 'Invitation details for the acceptance page', type: PublicInvitationResponse })
    @HttpCode(HttpStatus.OK)
    @Get(':token')
    async getByToken(@Param('token') token: string): Promise<PublicInvitationResponse> {
        return this.invitationService.getByToken(token);
    }

    @ApiBearerAuth()
    @AllowNoTenant()
    @ApiOperation({ summary: 'Accept an invitation with the authenticated Ory identity (tenant-optional token)' })
    @ApiOkResponse({ description: 'Invitation accepted; tenant membership created', type: UserResponse })
    @HttpCode(HttpStatus.OK)
    @Post(':token/accept')
    async accept(@Param('token') token: string, @CurrentUser() user: IAuthenticatedUser): Promise<UserResponse> {
        return this.invitationService.accept(token, user);
    }
}
