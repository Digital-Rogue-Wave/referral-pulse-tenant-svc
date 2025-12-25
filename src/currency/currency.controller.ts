import { Controller, Get, Post, Body, HttpCode, HttpStatus, UseInterceptors, Param, Put, Delete } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiCreatedResponse, ApiBody } from '@nestjs/swagger';
import { MapInterceptor } from '@automapper/nestjs';
import { CurrencyService } from './currency.service';
import { CurrencyEntity } from './currency.entity';
import { CurrencyDto } from './dto/currency.dto';
import { CreateCurrencyDto } from './dto/create-currency.dto';
import { UpdateCurrencyDto } from './dto/update-currency.dto';
import { NullableType } from '@mod/types/nullable.type';
import { DeleteResult } from 'typeorm';

@ApiTags('Currencies')
@Controller({ path: 'currencies', version: '1' })
export class CurrencyController {
    constructor(private readonly currencyService: CurrencyService) {}

    @Post()
    @ApiBody({ type: CreateCurrencyDto })
    @ApiCreatedResponse({ type: CurrencyDto })
    @UseInterceptors(MapInterceptor(CurrencyEntity, CurrencyDto))
    @HttpCode(HttpStatus.CREATED)
    async create(@Body() createCurrencyDto: CreateCurrencyDto): Promise<CurrencyEntity> {
        return this.currencyService.create(createCurrencyDto);
    }

    @Get()
    @ApiOkResponse({ type: CurrencyDto, isArray: true })
    @UseInterceptors(MapInterceptor(CurrencyEntity, CurrencyDto, { isArray: true }))
    @HttpCode(HttpStatus.OK)
    async findAll(): Promise<CurrencyEntity[]> {
        return this.currencyService.findAll();
    }

    @Get(':code')
    @ApiOkResponse({ type: CurrencyDto })
    @UseInterceptors(MapInterceptor(CurrencyEntity, CurrencyDto))
    @HttpCode(HttpStatus.OK)
    async findOne(@Param('code') code: string): Promise<NullableType<CurrencyEntity>> {
        return this.currencyService.findOne({ code });
    }

    @Put(':code')
    @ApiBody({ type: UpdateCurrencyDto })
    @ApiCreatedResponse({ type: CurrencyDto })
    @UseInterceptors(MapInterceptor(CurrencyEntity, CurrencyDto))
    @HttpCode(HttpStatus.OK)
    async update(@Param('code') code: string, @Body() updateCurrencyDto: UpdateCurrencyDto): Promise<CurrencyEntity> {
        return this.currencyService.update(code, updateCurrencyDto);
    }

    @Delete(':code')
    @ApiBody({ type: UpdateCurrencyDto })
    @ApiCreatedResponse({ type: CurrencyDto })
    @UseInterceptors(MapInterceptor(CurrencyEntity, CurrencyDto))
    @HttpCode(HttpStatus.OK)
    async remove(@Param('code') code: string): Promise<DeleteResult> {
        return this.currencyService.remove(code);
    }
}
