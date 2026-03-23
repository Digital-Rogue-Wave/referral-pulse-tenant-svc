import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { TeamMemberRole, TeamMemberStatus } from '../team-member.types';

export class CreateTeamMemberDto {
    @ApiProperty({
        description: 'User ID to add as team member',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    @IsString()
    @IsNotEmpty()
    userId!: string;

    @ApiProperty({
        description: 'Role of the team member',
        example: 'MEMBER',
        enum: Object.values(TeamMemberRole),
    })
    @IsString()
    @IsIn(Object.values(TeamMemberRole))
    role!: string;

    @ApiPropertyOptional({
        description: 'Status of the team member',
        example: 'active',
        enum: Object.values(TeamMemberStatus),
        default: 'active',
    })
    @IsOptional()
    @IsString()
    @IsIn(Object.values(TeamMemberStatus))
    status?: string;
}
