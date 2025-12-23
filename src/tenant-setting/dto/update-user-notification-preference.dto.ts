import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class NotificationOverridesDto {
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

export class UpdateUserNotificationPreferenceDto {
    @ApiPropertyOptional({ type: NotificationOverridesDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => NotificationOverridesDto)
    overrides?: NotificationOverridesDto;
}
