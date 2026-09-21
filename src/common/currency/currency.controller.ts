import { Controller, Get, Post, Body, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiCreatedResponse, ApiBody } from '@nestjs/swagger';

import { PlatformAdmin } from '@common/auth/require-permission.decorator';

import { CurrencyService } from './currency.service';
import { Currency as CurrencyModel } from '@prisma-gen/generated/client';
import { CursorPage } from '@common/http-contract/cursor-page';
import { CurrencyDto, CreateCurrencyDto, UpdateCurrencyDto } from '@domains/common/currency';

@ApiTags('Currencies')
@Controller({ path: 'currencies', version: '1' })
export class CurrencyController {
    constructor(private readonly currencyService: CurrencyService) {}

    @ApiOkResponse({ description: 'The full currency catalog, ordered by ISO code', type: CursorPage })
    @HttpCode(HttpStatus.OK)
    @Get()
    async list(): Promise<CursorPage<CurrencyModel>> {
        return this.currencyService.catalog();
    }

    // The currency table is platform-wide reference data: no tenant may change it.
    @PlatformAdmin()
    @ApiCreatedResponse({ type: CurrencyDto })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async createCurrency(@Body() currencyDto: CreateCurrencyDto): Promise<CurrencyModel> {
        return this.currencyService.create(currencyDto);
    }

    @PlatformAdmin()
    @ApiBody({ type: UpdateCurrencyDto })
    @ApiOkResponse({ type: CurrencyDto })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    async updateCurrency(@Param('id') id: string, @Body() currencyDto: UpdateCurrencyDto): Promise<CurrencyModel> {
        return this.currencyService.updateById(id, currencyDto);
    }
}
