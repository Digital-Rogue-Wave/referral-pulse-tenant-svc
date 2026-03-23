import { Currency as CurrencyModel } from '@prisma-gen/generated/client';
import { PaginateConfig, FilterOperator } from '@common/nestjs-prisma-pagination';

/**
 * Pagination configuration for Currency Model
 */
export const CURRENCY_PAGINATE_CONFIG: PaginateConfig<CurrencyModel> = {
    sortableColumns: ['code', 'name', 'symbol', 'decimals', 'createdAt', 'updatedAt'],
    defaultSortBy: [['name', 'ASC']],
    searchableColumns: ['code', 'name', 'symbol'],
    filterableColumns: {
        code: [FilterOperator.EQ, FilterOperator.IN, FilterOperator.NOT, FilterOperator.NOT_IN],
        name: [
            FilterOperator.EQ,
            FilterOperator.CONTAINS,
            FilterOperator.ILIKE,
            FilterOperator.STARTS_WITH,
            FilterOperator.ENDS_WITH,
        ],
    },
    defaultLimit: 100, // Currencies are usually a small set
    maxLimit: 1000,

    // Cursor pagination config
    cursorColumn: 'code', // Currency uses 'code' as primary key, not 'id'
    cursorIncludeTotalCount: true, // Small dataset, OK to include count
};
