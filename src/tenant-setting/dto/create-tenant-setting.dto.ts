import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

class BrandingSettingsDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    primaryColor: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    secondaryColor: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    fontFamily: string;
}

class NotificationSettingsDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    emailEnabled: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    webhookEnabled: boolean;
}

class GeneralSettingsOptionsDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    timezone: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    locale: string;
}

export class CreateTenantSettingDto {
    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    currencyCode: string;

    @ApiPropertyOptional({ type: BrandingSettingsDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => BrandingSettingsDto)
    branding?: BrandingSettingsDto;

    @ApiPropertyOptional({ type: NotificationSettingsDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => NotificationSettingsDto)
    notifications?: NotificationSettingsDto;

    @ApiPropertyOptional({ type: GeneralSettingsOptionsDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => GeneralSettingsOptionsDto)
    general?: GeneralSettingsOptionsDto;
}
