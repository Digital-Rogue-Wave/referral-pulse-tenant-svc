import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';

import { Prisma, Currency as CurrencyModel } from '@prisma-gen/generated/client';
import { BaseService } from '../helper/base.service';
import { NullableType } from '@app/types';
import {
    Paginated,
    PaginateQuery,
    prismaPaginate,
    CursorPaginated,
    CursorPaginateQuery,
    prismaCursorPaginate
} from '@app/common/nestjs-prisma-pagination';
import { CURRENCY_PAGINATE_CONFIG } from './currency.pagination';

@Injectable()
export class CurrencyService implements BaseService<
    CurrencyModel,
    Prisma.CurrencyCreateInput,
    Prisma.CurrencyUpdateInput,
    Prisma.CurrencyWhereUniqueInput,
    Prisma.CurrencyFindManyArgs
> {
    constructor(private readonly prisma: DatabaseService) {}

    async create(createDto: Prisma.CurrencyCreateInput): Promise<CurrencyModel> {
        return this.prisma.currency.create({
            data: createDto
        });
    }

    async list(query: PaginateQuery<CurrencyModel>): Promise<Paginated<CurrencyModel>> {
        return prismaPaginate(query, this.prisma.currency, CURRENCY_PAGINATE_CONFIG, {
            deletedAt: null
        });
    }

    /**
     * List currencies with cursor-based pagination
     * More efficient for large datasets and infinite scroll UIs
     */
    async listCursor(query: CursorPaginateQuery<CurrencyModel>): Promise<CursorPaginated<CurrencyModel>> {
        return prismaCursorPaginate(query, this.prisma.currency, CURRENCY_PAGINATE_CONFIG, {
            deletedAt: null
        });
    }

    async listUnpaginated(options?: Prisma.CurrencyFindManyArgs): Promise<CurrencyModel[]> {
        return this.prisma.currency.findMany(options);
    }

    async readOne(field: Prisma.CurrencyWhereUniqueInput): Promise<NullableType<CurrencyModel>> {
        return this.prisma.currency.findUnique({
            where: field
        });
    }

    async readOneOrFail(field: Prisma.CurrencyWhereInput): Promise<CurrencyModel> {
        return this.prisma.currency.findFirstOrThrow({
            where: field
        });
    }

    async updateById(code: string, data: Prisma.CurrencyUpdateInput): Promise<CurrencyModel> {
        return this.prisma.currency.update({
            where: { code },
            data
        });
    }

    async deleteById(code: string): Promise<CurrencyModel> {
        return this.prisma.currency.delete({
            where: { code }
        });
    }

    async getTotal(where?: Prisma.CurrencyWhereInput): Promise<number> {
        return this.prisma.currency.count({
            where
        });
    }
}
