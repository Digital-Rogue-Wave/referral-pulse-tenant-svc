import { IsOptional, IsTimeZone, IsLocale, ValidateNested } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CurrencyDto } from '@mod/currency/dto/currency.dto';
import { Type } from 'class-transformer';

export class GeneralSettingsDto {
    @ApiPropertyOptional({ example: 'UTC', description: 'Tenant timezone', required: false })
    @IsOptional()
    @IsTimeZone()
    timezone?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @ValidateNested()
    @Type(() => CurrencyDto)
    currency?: CurrencyDto;

    @ApiPropertyOptional({ example: 'en-US', description: 'Tenant locale', required: false })
    @IsOptional()
    @IsLocale()
    locale?: string;
}
