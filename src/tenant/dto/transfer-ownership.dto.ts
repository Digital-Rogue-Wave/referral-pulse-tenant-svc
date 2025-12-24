import { IsString, IsNotEmpty, IsStrongPassword } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferOwnershipDto {
    @ApiProperty({ description: 'User ID of the new owner' })
    @IsString()
    newOwnerId: string;

    @ApiProperty({ description: 'Password of the new owner' })
    @IsStrongPassword({
        minLength: 3,
        minLowercase: 0,
        minUppercase: 0,
        minNumbers: 0,
        minSymbols: 0
    })
    @IsNotEmpty()
    password: string;
}
