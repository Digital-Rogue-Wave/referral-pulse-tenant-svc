import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RoleEnum } from '@mod/common/enums/role.enum';

export class UpdateTeamMemberDto {
    @ApiProperty({ enum: RoleEnum, enumName: 'RoleEnum' })
    @IsEnum(RoleEnum)
    @IsNotEmpty()
    role: RoleEnum;
}
