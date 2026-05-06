import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UsageUpdateDto {
    @ApiProperty()
    @IsString()
    @MaxLength(100)
    metric!: string;

    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @IsNumber()
    @Min(1)
    amount?: number;
}
