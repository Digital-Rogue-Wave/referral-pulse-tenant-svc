import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BrandingSettingsDto {
    @ApiProperty({ example: '#000000', description: 'Primary brand color', required: false })
    @IsOptional()
    @IsString()
    @Matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, { message: 'Primary color must be a valid hex color code' })
    primaryColor?: string;

    @ApiProperty({ example: '#ffffff', description: 'Secondary brand color', required: false })
    @IsOptional()
    @IsString()
    @Matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, { message: 'Secondary color must be a valid hex color code' })
    secondaryColor?: string;

    @ApiProperty({ example: 'Inter', description: 'Font family', required: false })
    @IsOptional()
    @IsString()
    fontFamily?: string;

    @ApiProperty({ example: 'https://example.com/logo.png', description: 'Custom logo URL', required: false })
    @IsOptional()
    @IsString()
    logoUrl?: string;

    @ApiProperty({ example: 'https://example.com/favicon.ico', description: 'Custom favicon URL', required: false })
    @IsOptional()
    @IsString()
    faviconUrl?: string;
}
