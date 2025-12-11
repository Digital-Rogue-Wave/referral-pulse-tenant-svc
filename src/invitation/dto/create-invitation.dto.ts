import { IsEmail, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RoleEnum } from '@mod/common/enums/role.enum';

export class CreateInvitationDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({ enum: RoleEnum, enumName: 'RoleEnum' })
    @IsEnum(RoleEnum)
    @IsNotEmpty()
    role: RoleEnum;
}
