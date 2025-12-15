import { RoleEnum } from '@mod/common/enums/role.enum';
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
}
