import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiBody, ApiOkResponse, ApiHeader } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation, KetoResource } from '@common/auth/keto.constants';
import { Paginate, PaginateQuery, Paginated, ApiPaginationQuery } from '@common/nestjs-prisma-pagination';
import { Idempotent, IdempotencyScope } from '@common/idempotency';

import { CreateTeamMemberDto, UpdateTeamMemberDto, TeamMemberResponse } from '@domains/team-member';

import { TeamMemberService } from './team-member.service';
import { TEAM_MEMBER_PAGINATE_CONFIG } from './team-member.pagination';

@ApiTags('Team Members')
@ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: 'Tenant ID header',
    schema: { type: 'string' }
})
@Controller({ path: 'team-members', version: '1' })
@ApiBearerAuth()
export class TeamMemberController {
    constructor(private readonly teamMemberService: TeamMemberService) {}

    @ApiBody({ type: CreateTeamMemberDto })
    @ApiCreatedResponse({
        description: 'Team member created successfully',
        type: TeamMemberResponse
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.MEMBER, relation: KetoRelation.CREATE })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    async create(@Body() dto: CreateTeamMemberDto, @CurrentUser() user: IAuthenticatedUser): Promise<TeamMemberResponse> {
        return this.teamMemberService.create(user.userId, dto);
    }

    @ApiPaginationQuery(TEAM_MEMBER_PAGINATE_CONFIG)
    @ApiOkResponse({
        description: 'List of team members',
        type: TeamMemberResponse,
        isArray: true
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.MEMBER, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Paginate() query: PaginateQuery): Promise<Paginated<TeamMemberResponse>> {
        return this.teamMemberService.findAll(query);
    }

    @ApiOkResponse({
        description: 'Team member details',
        type: TeamMemberResponse
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<TeamMemberResponse> {
        return this.teamMemberService.findById(id);
    }

    @ApiBody({ type: UpdateTeamMemberDto })
    @ApiOkResponse({
        description: 'Team member updated successfully',
        type: TeamMemberResponse
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.MEMBER, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async update(@Param('id') id: string, @Body() dto: UpdateTeamMemberDto, @CurrentUser() user: IAuthenticatedUser): Promise<TeamMemberResponse> {
        return this.teamMemberService.updateRole(id, user.userId, dto);
    }

    @ApiOkResponse({ description: 'Team member removed successfully' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.MEMBER, relation: KetoRelation.DELETE })
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async remove(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        await this.teamMemberService.remove(id, user.userId);
    }
}
