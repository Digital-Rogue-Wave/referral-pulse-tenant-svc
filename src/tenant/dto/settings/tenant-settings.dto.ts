import { ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { BrandingSettingsDto } from './branding-settings.dto';
import { NotificationSettingsDto } from './notification-settings.dto';
import { GeneralSettingsDto } from './general-settings.dto';

export class TenantSettingsDto {
    @ApiProperty({ type: BrandingSettingsDto, required: false })
    @IsOptional()
    @ValidateNested()
    @Type(() => BrandingSettingsDto)
    branding?: BrandingSettingsDto;

    @ApiProperty({ type: NotificationSettingsDto, required: false })
    @IsOptional()
    @ValidateNested()
    @Type(() => NotificationSettingsDto)
    notifications?: NotificationSettingsDto;

    @ApiProperty({ type: GeneralSettingsDto, required: false })
    @IsOptional()
    @ValidateNested()
    @Type(() => GeneralSettingsDto)
    general?: GeneralSettingsDto;
}
