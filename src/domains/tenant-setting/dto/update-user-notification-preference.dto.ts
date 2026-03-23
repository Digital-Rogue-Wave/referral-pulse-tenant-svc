import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateUserNotificationPreferenceDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    emailEnabled?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    smsEnabled?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    pushEnabled?: boolean;
}
