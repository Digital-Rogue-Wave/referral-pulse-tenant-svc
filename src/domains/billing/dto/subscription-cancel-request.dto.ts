import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubscriptionCancelRequestDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}
