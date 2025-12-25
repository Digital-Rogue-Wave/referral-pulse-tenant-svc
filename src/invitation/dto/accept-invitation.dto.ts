import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EditInvitationDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    token: string;
}
