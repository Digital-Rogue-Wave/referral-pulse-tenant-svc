import { IsString, IsNotEmpty } from 'class-validator';

export class EditInvitationDto {
    @IsString()
    @IsNotEmpty()
    token: string;
}
