import { IsEmail, IsNotEmpty, IsEnum, IsString, IsDate } from 'class-validator';
import { RoleEnum } from '@mod/common/enums/role.enum';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';
import { TenantEntity } from '@mod/tenant/tenant.entity';

export class CreateFullInvitationDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsEnum(RoleEnum)
    @IsNotEmpty()
    role: RoleEnum;

    @IsString()
    @IsNotEmpty()
    token: string;

    @IsDate()
    @IsNotEmpty()
    expiresAt: Date;

    @IsEnum(InvitationStatusEnum)
    @IsNotEmpty()
    status: InvitationStatusEnum;

    @IsNotEmpty()
    tenant: TenantEntity;
}
