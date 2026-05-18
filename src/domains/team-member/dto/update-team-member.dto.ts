import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { TeamMemberRole, TeamMemberStatus } from '../team-member.types';

export class UpdateTeamMemberDto {
    @ApiPropertyOptional({
        description: 'Role of the team member',
        example: 'ADMIN',
        enum: Object.values(TeamMemberRole),
    })
    @IsOptional()
    @IsString()
    @IsIn(Object.values(TeamMemberRole))
    role?: string;

    @ApiPropertyOptional({
        description: 'Status of the team member',
        example: 'suspended',
        enum: Object.values(TeamMemberStatus),
    })
    @IsOptional()
    @IsString()
    @IsIn(Object.values(TeamMemberStatus))
    status?: string;
}
