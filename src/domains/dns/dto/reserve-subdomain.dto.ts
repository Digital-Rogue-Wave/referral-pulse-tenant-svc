import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReserveSubdomainDto {
    @ApiProperty({ description: 'Subdomain slug to reserve', example: 'my-company' })
    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    @MaxLength(63)
    @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
        message: 'Subdomain must contain only lowercase letters, numbers, and hyphens',
    })
    slug!: string;
}