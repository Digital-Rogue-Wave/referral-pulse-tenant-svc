import { RoleEnum } from '@mod/common/enums/role.enum';
import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';
import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';

export class TeamMemberDto extends EntityHelperDto {
    @ApiProperty()
    @AutoMap()
    id: string;

    @ApiProperty()
    @AutoMap()
    userId: string;

    @ApiProperty({ enum: RoleEnum, enumName: 'RoleEnum' })
    @AutoMap()
    role: RoleEnum;
}
