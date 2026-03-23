import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddCustomDomainDto {
    @ApiProperty({ description: 'Custom domain to add', example: 'referrals.example.com' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(253)
    domain!: string;
}