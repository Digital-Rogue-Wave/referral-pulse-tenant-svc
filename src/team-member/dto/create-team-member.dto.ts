import { RoleEnum } from '@mod/common/enums/role.enum';
import { TeamMemberStatusEnum } from '@mod/common/enums/team-member-status.enum';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';

export class CreateTeamMemberDto {
    @ApiProperty()
    @IsString()
    userId: string;

    @ApiProperty()
    @IsString()
    tenantId: string;

    @ApiProperty()
    @IsEnum(RoleEnum)
    role: RoleEnum;

    @ApiProperty({ enum: TeamMemberStatusEnum, default: TeamMemberStatusEnum.ACTIVE })
    @IsEnum(TeamMemberStatusEnum)
    status?: TeamMemberStatusEnum;
}
