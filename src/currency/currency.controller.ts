import { Controller, Get, Post, Body, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { CurrencyService } from './currency.service';
import { CurrencyEntity } from './currency.entity';
import { CurrencyDto } from './dto/currency.dto';
import { MapInterceptor } from '@automapper/nestjs';

@ApiTags('Currencies')
@Controller({ path: 'currencies', version: '1' })
export class CurrencyController {
    constructor(private readonly currencyService: CurrencyService) {}

    @ApiOkResponse({ type: CurrencyDto, isArray: true })
    @UseInterceptors(MapInterceptor(CurrencyEntity, CurrencyDto, { isArray: true }))
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(): Promise<CurrencyEntity[]> {
        return this.currencyService.findAll();
    }

    @ApiCreatedResponse({ type: CurrencyDto })
    @UseInterceptors(MapInterceptor(CurrencyEntity, CurrencyDto))
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(@Body() currencyDto: CurrencyDto): Promise<CurrencyEntity> {
        return this.currencyService.create(currencyDto);
    }
}
