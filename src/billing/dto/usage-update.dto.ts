import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UsageUpdateDto {
    @ApiProperty({ description: 'Usage metric identifier (e.g. campaigns, seats, referred_users)' })
    @IsString()
    @IsNotEmpty()
    metric: string;

    @ApiPropertyOptional({ description: 'Amount to increment or decrement (defaults to 1 if omitted)' })
    @IsOptional()
    amount?: number;
}
