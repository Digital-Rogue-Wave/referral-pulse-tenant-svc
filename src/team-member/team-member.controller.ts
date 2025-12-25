import { ApiTags, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { Controller, Get, Put, Delete, Param, Body, UseGuards, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { MapInterceptor, InjectMapper } from '@automapper/nestjs';
import { TeamMemberEntity } from './team-member.entity';
import { TeamMemberService } from './team-member.service';
import { TeamMemberDto } from './dto/team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { ApiPaginationQuery, Paginate, PaginateQuery } from 'nestjs-paginate';
import { tenantMemberPaginationConfig } from './config/tenant-member-pagination-config';
import { PaginatedDto } from '@mod/common/serialization/paginated.dto';
import { Mapper } from '@automapper/core';
import { DeleteResult } from 'typeorm';

@ApiTags('Team Members')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, KetoGuard)
@Controller({ path: 'tenant-members', version: '1' })
export class TeamMemberController {
    constructor(
        private readonly teamMemberService: TeamMemberService,
        @InjectMapper() private readonly mapper: Mapper
    ) {}

    @Get()
    @ApiPaginationQuery(tenantMemberPaginationConfig)
    @ApiOkResponse({ type: PaginatedDto<TeamMemberEntity, TeamMemberDto>, description: 'List of team members' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.VIEW, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    async listMembers(@Paginate() query: PaginateQuery): Promise<PaginatedDto<TeamMemberEntity, TeamMemberDto>> {
        const member = await this.teamMemberService.findAll(query);
        return new PaginatedDto<TeamMemberEntity, TeamMemberDto>(this.mapper, member, TeamMemberEntity, TeamMemberDto);
    }

    @Put(':id')
    @ApiOkResponse({ type: TeamMemberDto, description: 'Team member role updated' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'tenantId' })
    @UseInterceptors(MapInterceptor(TeamMemberEntity, TeamMemberDto))
    @HttpCode(HttpStatus.OK)
    async updateMember(@Param('id') memberId: string, @Body() updateDto: UpdateTeamMemberDto): Promise<TeamMemberEntity> {
        return this.teamMemberService.updateRole(memberId, updateDto);
    }

    @Delete(':id')
    @ApiOkResponse({ description: 'Team member removed' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'tenantId' })
    @HttpCode(HttpStatus.OK)
    async removeMember(@Param('id') memberId: string): Promise<DeleteResult> {
        return await this.teamMemberService.remove(memberId);
    }
}
