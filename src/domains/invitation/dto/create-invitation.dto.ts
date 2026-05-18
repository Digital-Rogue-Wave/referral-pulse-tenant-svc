import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsIn } from 'class-validator';
import { InvitationRole } from '../invitation.types';

export class CreateInvitationDto {
    @ApiProperty({
        description: 'Email address of the person to invite',
        example: 'user@example.com',
    })
    @IsEmail()
    @IsNotEmpty()
    email!: string;

    @ApiProperty({
        description: 'Role to assign to the invitee',
        example: 'MEMBER',
        enum: Object.values(InvitationRole),
    })
    @IsString()
    @IsIn(Object.values(InvitationRole))
    role!: string;
}
