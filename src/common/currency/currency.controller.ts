import { Controller, Get, Post, Body, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiCreatedResponse, ApiBody } from '@nestjs/swagger';

import { CurrencyService } from './currency.service';
import { Currency as CurrencyModel } from '@prisma-gen/generated/client';
import {
    ApiPaginationQuery,
    Paginate,
    PaginateQuery,
    Paginated,
    ApiCursorPaginationQuery,
    CursorPaginate,
    CursorPaginateQuery,
    CursorPaginated
} from '@app/common/nestjs-prisma-pagination';
import { CurrencyDto, CreateCurrencyDto, UpdateCurrencyDto } from '@domains/common/currency';
import { CURRENCY_PAGINATE_CONFIG } from './currency.pagination';

@ApiTags('Currencies')
@Controller({ path: 'currencies', version: '1' })
export class CurrencyController {
    constructor(private readonly currencyService: CurrencyService) {}

    @ApiPaginationQuery(CURRENCY_PAGINATE_CONFIG)
    @ApiOkResponse({ type: CurrencyDto, isArray: true })
    @HttpCode(HttpStatus.OK)
    @Get()
    async list(@Paginate() query: PaginateQuery<CurrencyModel>): Promise<Paginated<CurrencyModel>> {
        return this.currencyService.list(query);
    }

    /**
     * List currencies with cursor-based pagination
     * More efficient for large datasets and infinite scroll UIs
     */
    @ApiCursorPaginationQuery(CURRENCY_PAGINATE_CONFIG)
    @ApiOkResponse({
        description: 'Returns currencies with cursor-based pagination',
        schema: {
            type: 'object',
            properties: {
                edges: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            node: { $ref: '#/components/schemas/CurrencyDto' },
                            cursor: { type: 'string' }
                        }
                    }
                },
                pageInfo: {
                    type: 'object',
                    properties: {
                        startCursor: { type: 'string', nullable: true },
                        endCursor: { type: 'string', nullable: true },
                        hasNextPage: { type: 'boolean' },
                        hasPreviousPage: { type: 'boolean' }
                    }
                },
                totalCount: { type: 'number' }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    @Get('cursor')
    async listCursor(@CursorPaginate() query: CursorPaginateQuery<CurrencyModel>): Promise<CursorPaginated<CurrencyModel>> {
        return this.currencyService.listCursor(query);
    }

    @ApiOkResponse({ type: CurrencyDto, isArray: true })
    @HttpCode(HttpStatus.OK)
    @Get('all')
    async listCurrencies(): Promise<CurrencyModel[]> {
        return this.currencyService.listUnpaginated();
    }

    @ApiCreatedResponse({ type: CurrencyDto })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async createCurrency(@Body() currencyDto: CreateCurrencyDto): Promise<CurrencyModel> {
        return this.currencyService.create(currencyDto);
    }

    @ApiBody({ type: UpdateCurrencyDto })
    @ApiOkResponse({ type: CurrencyDto })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    async updateCurrency(@Param('id') id: string, @Body() currencyDto: UpdateCurrencyDto): Promise<CurrencyModel> {
        return this.currencyService.updateById(id, currencyDto);
    }
}
