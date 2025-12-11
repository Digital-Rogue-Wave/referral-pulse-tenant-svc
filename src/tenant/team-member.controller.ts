import { ApiTags, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { Controller, Get, Put, Delete, Param, Body, UseGuards, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { MapInterceptor } from '@automapper/nestjs';
import { TeamMemberEntity } from './team-member.entity';
import { TeamMemberService } from './team-member.service';
import { TeamMemberDto } from './dto/team-member/team-member.dto';
import { UpdateTeamMemberDto } from './dto/team-member/update-team-member.dto';

@ApiTags('Team Members')
@ApiBearerAuth()
@Controller({ path: 'tenants', version: '1' })
export class TeamMemberController {
    constructor(private readonly teamMemberService: TeamMemberService) {}

    @ApiOkResponse({ type: TeamMemberDto, description: 'List of team members' })
    @UseGuards(JwtAuthGuard, KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.VIEW, objectParam: 'id' })
    @UseInterceptors(MapInterceptor(TeamMemberEntity, TeamMemberDto, { isArray: true }))
    @HttpCode(HttpStatus.OK)
    @Get(':id/members')
    async listMembers(@Param('id') tenantId: string): Promise<TeamMemberEntity[]> {
        return this.teamMemberService.findAll({ where: { tenant: { id: tenantId } } });
    }

    @ApiOkResponse({ type: TeamMemberDto, description: 'Team member role updated' })
    @UseGuards(JwtAuthGuard, KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'tenantId' })
    @UseInterceptors(MapInterceptor(TeamMemberEntity, TeamMemberDto))
    @HttpCode(HttpStatus.OK)
    @Put(':tenantId/members/:memberId')
    async updateMember(
        @Param('tenantId') tenantId: string,
        @Param('memberId') memberId: string,
        @Body() updateDto: UpdateTeamMemberDto
    ): Promise<TeamMemberEntity> {
        return this.teamMemberService.updateRole(tenantId, memberId, updateDto);
    }

    @ApiOkResponse({ description: 'Team member removed' })
    @UseGuards(JwtAuthGuard, KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'tenantId' })
    @HttpCode(HttpStatus.OK)
    @Delete(':tenantId/members/:memberId')
    async removeMember(@Param('tenantId') tenantId: string, @Param('memberId') memberId: string): Promise<TeamMemberEntity> {
        return await this.teamMemberService.remove(tenantId, memberId);
    }
}
