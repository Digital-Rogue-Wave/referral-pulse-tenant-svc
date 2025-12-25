import { IsEmail, IsNotEmpty, IsEnum, IsString, IsDate } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RoleEnum } from '@mod/common/enums/role.enum';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';
import { Type } from 'class-transformer';

export class CreateFullInvitationDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({ enum: RoleEnum, enumName: 'RoleEnum' })
    @IsEnum(RoleEnum)
    @IsNotEmpty()
    role: RoleEnum;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    token: string;

    @ApiProperty()
    @Type(() => Date)
    @IsDate()
    @IsNotEmpty()
    expiresAt: Date;

    @ApiProperty({ enum: InvitationStatusEnum, enumName: 'InvitationStatusEnum' })
    @IsEnum(InvitationStatusEnum)
    @IsNotEmpty()
    status: InvitationStatusEnum;
}
