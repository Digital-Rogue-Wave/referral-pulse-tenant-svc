import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferOwnershipDto {
    @ApiProperty({ description: 'User ID of the new owner' })
    @IsString()
    @IsNotEmpty()
    newOwnerId: string;
}
