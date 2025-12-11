import { ApiProperty } from '@nestjs/swagger';
import { TenantDto } from '@mod/tenant/dto/tenant.dto';
import { RoleEnum } from '@mod/common/enums/role.enum';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';

export class InvitationDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    email: string;

    @ApiProperty({ enum: RoleEnum, enumName: 'RoleEnum' })
    role: RoleEnum;

    @ApiProperty({ enum: InvitationStatusEnum, enumName: 'InvitationStatusEnum' })
    status: InvitationStatusEnum;

    @ApiProperty()
    token: string;

    @ApiProperty()
    expiresAt: Date;

    @ApiProperty({ type: () => TenantDto })
    tenant: TenantDto;
}
