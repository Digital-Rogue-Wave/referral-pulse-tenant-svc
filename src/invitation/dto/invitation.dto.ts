import { ApiProperty } from '@nestjs/swagger';
import { TenantDto } from '@mod/tenant/dto/tenant/tenant.dto';
import { RoleEnum } from '@mod/common/enums/role.enum';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';
import { AutoMap } from '@automapper/classes';
import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';

export class InvitationDto extends EntityHelperDto {
    @ApiProperty()
    @AutoMap()
    id: string;

    @ApiProperty()
    @AutoMap()
    email: string;

    @ApiProperty({ enum: RoleEnum, enumName: 'RoleEnum' })
    @AutoMap()
    role: RoleEnum;

    @ApiProperty({ enum: InvitationStatusEnum, enumName: 'InvitationStatusEnum' })
    @AutoMap()
    status: InvitationStatusEnum;

    @ApiProperty()
    @AutoMap()
    token: string;

    @ApiProperty()
    @AutoMap()
    expiresAt: Date;

    @ApiProperty({ type: () => TenantDto })
    @AutoMap(() => TenantDto)
    tenant: TenantDto;
}
