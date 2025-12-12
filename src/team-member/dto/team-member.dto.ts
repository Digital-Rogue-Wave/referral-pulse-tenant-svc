import { ApiProperty } from '@nestjs/swagger';
import { RoleEnum } from '@mod/common/enums/role.enum';

export class TeamMemberDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    userId: string;

    @ApiProperty({ enum: RoleEnum, enumName: 'RoleEnum' })
    role: RoleEnum;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;
}
