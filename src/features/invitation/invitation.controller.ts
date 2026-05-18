import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiBody, ApiOkResponse, ApiHeader } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation, KetoResource } from '@common/auth/keto.constants';
import { Public } from '@common/auth/public.decorator';
import { Paginate, PaginateQuery, Paginated, ApiPaginationQuery } from '@common/nestjs-prisma-pagination';
import { Idempotent, IdempotencyScope } from '@common/idempotency';

import {
    CreateInvitationDto,
    AcceptInvitationDto,
    InvitationResponse,
    InvitationWithTokenResponse,
    InvitationValidationResponse,
} from '@domains/invitation';

import { InvitationService } from './invitation.service';
import { INVITATION_PAGINATE_CONFIG } from './invitation.pagination';

/**
 * Invitation Controller - Tenant-aware endpoints
 * Requires authentication and tenant context
 */
@ApiTags('Invitations')
@ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: 'Tenant ID header',
    schema: { type: 'string' },
})
@Controller({ path: 'invitations', version: '1' })
@ApiBearerAuth()
export class InvitationController {
    constructor(private readonly invitationService: InvitationService) {}

    @ApiBody({ type: CreateInvitationDto })
    @ApiCreatedResponse({
        description: 'Invitation created successfully',
        type: InvitationWithTokenResponse,
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        object: KetoResource.INVITATION,
        relation: KetoRelation.CREATE,
    })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    async create(
        @Body() dto: CreateInvitationDto,
        @CurrentUser() user: IAuthenticatedUser,
    ): Promise<InvitationWithTokenResponse> {
        return this.invitationService.create(user.userId, dto);
    }

    @ApiPaginationQuery(INVITATION_PAGINATE_CONFIG)
    @ApiOkResponse({
        description: 'List of invitations',
        type: InvitationResponse,
        isArray: true,
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        object: KetoResource.INVITATION,
        relation: KetoRelation.READ,
    })
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Paginate() query: PaginateQuery): Promise<Paginated<InvitationResponse>> {
        return this.invitationService.findAll(query);
    }

    @ApiOkResponse({
        description: 'Invitation details',
        type: InvitationResponse,
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<InvitationResponse> {
        return this.invitationService.findById(id);
    }

    @ApiOkResponse({ description: 'Invitation revoked successfully' })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        object: KetoResource.INVITATION,
        relation: KetoRelation.DELETE,
    })
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    async revoke(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        await this.invitationService.revoke(id, user.userId);
    }

    @ApiOkResponse({
        description: 'Invitation resent successfully',
        type: InvitationWithTokenResponse,
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        object: KetoResource.INVITATION,
        relation: KetoRelation.UPDATE,
    })
    @HttpCode(HttpStatus.OK)
    @Post(':id/resend')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async resend(
        @Param('id') id: string,
        @CurrentUser() user: IAuthenticatedUser,
    ): Promise<InvitationWithTokenResponse> {
        return this.invitationService.resend(id, user.userId);
    }
}

/**
 * Public Invitation Controller - No authentication required
 * Used for accepting/rejecting invitations via email link
 */
@ApiTags('Invitations (Public)')
@Controller({ path: 'invitations/public', version: '1' })
export class PublicInvitationController {
    constructor(private readonly invitationService: InvitationService) {}

    @ApiOkResponse({
        description: 'Invitation validation result',
        type: InvitationValidationResponse,
    })
    @Public()
    @HttpCode(HttpStatus.OK)
    @Get('validate/:token')
    async validate(@Param('token') token: string): Promise<InvitationValidationResponse> {
        return this.invitationService.validate(token);
    }

    @ApiBody({ type: AcceptInvitationDto })
    @ApiOkResponse({
        description: 'Invitation accepted successfully',
        type: InvitationResponse,
    })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @Post('accept')
    @Idempotent({ scope: IdempotencyScope.User, ttl: 3600 })
    async accept(
        @Body() dto: AcceptInvitationDto,
        @CurrentUser() user: IAuthenticatedUser,
    ): Promise<InvitationResponse> {
        return this.invitationService.accept(dto.token, user.userId);
    }

    @ApiOkResponse({
        description: 'Invitation rejected successfully',
        type: InvitationResponse,
    })
    @Public()
    @HttpCode(HttpStatus.OK)
    @Post('reject/:token')
    async reject(@Param('token') token: string): Promise<InvitationResponse> {
        return this.invitationService.reject(token);
    }
}
