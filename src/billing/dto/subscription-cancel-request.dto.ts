import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubscriptionCancelRequestDto {
    @ApiPropertyOptional({
        description: 'Optional reason for cancelling the subscription'
    })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    reason?: string;
}
