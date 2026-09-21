import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';

import { Prisma, Currency as CurrencyModel } from '@prisma-gen/generated/client';
import { NullableType } from '@app/types';
import type { CursorPage } from '@common/http-contract/cursor-page';

@Injectable()
export class CurrencyService {
    constructor(private readonly prisma: DatabaseService) {}

    async create(createDto: Prisma.CurrencyCreateInput): Promise<CurrencyModel> {
        return this.prisma.currency.create({
            data: createDto
        });
    }

    /**
     * The whole currency catalog in the standard list envelope. It is small reference data keyed by ISO
     * code (not a ULID), so it is returned in one page, ordered by code.
     */
    async catalog(): Promise<CursorPage<CurrencyModel>> {
        const data = await this.prisma.currency.findMany({ where: { deletedAt: null }, orderBy: { code: 'asc' } });
        return { data, hasMore: false, nextCursor: null, prevCursor: null };
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
