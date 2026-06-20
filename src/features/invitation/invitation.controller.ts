import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { Public } from '@common/auth/public.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation, KetoResource } from '@common/auth/keto.constants';
import { Paginate, PaginateQuery, Paginated, ApiPaginationQuery } from '@common/nestjs-prisma-pagination';
import { Idempotent, IdempotencyScope } from '@common/idempotency';

import { CreateInvitationDto, InvitationResponse, PublicInvitationResponse } from '@domains/invitation';
import { UserResponse } from '@domains/user';

import { InvitationService } from './invitation.service';
import { INVITATION_PAGINATE_CONFIG } from './invitation.pagination';

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
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.USER, relation: KetoRelation.CREATE })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    async create(@Body() dto: CreateInvitationDto, @CurrentUser() user: IAuthenticatedUser): Promise<InvitationResponse> {
        return this.invitationService.create(user.userId, dto);
    }

    @ApiPaginationQuery(INVITATION_PAGINATE_CONFIG)
    @ApiOkResponse({ description: 'List of tenant invitations', type: InvitationResponse, isArray: true })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.USER, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Paginate() query: PaginateQuery): Promise<Paginated<InvitationResponse>> {
        return this.invitationService.findAll(query);
    }

    @ApiOkResponse({ description: 'Invitation re-issued with a fresh token', type: InvitationResponse })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.USER, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    @Post(':id/resend')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async resend(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<InvitationResponse> {
        return this.invitationService.resend(id, user.userId);
    }

    @ApiOkResponse({ description: 'Invitation revoked' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.USER, relation: KetoRelation.DELETE })
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
    @ApiOperation({ summary: 'Accept an invitation with the authenticated Ory identity' })
    @ApiOkResponse({ description: 'Invitation accepted; tenant membership created', type: UserResponse })
    @HttpCode(HttpStatus.OK)
    @Post(':token/accept')
    async accept(@Param('token') token: string, @CurrentUser() user: IAuthenticatedUser): Promise<UserResponse> {
        return this.invitationService.accept(token, user);
    }
}
