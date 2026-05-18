import { Paginated, PaginateQuery, FilterItem } from './types/paginate-query.interface';
import { PaginateConfig } from './types/paginate-config.type';
import { parseFilters, buildFilterWhere } from './filter';
import { parseSort } from './sort';

/**
 * Prisma delegate with findMany and count methods
 * NOTE: `any` is intentional — structural bridge for Prisma's generated delegate types.
 */

interface PrismaDelegate<T> {
    findMany(args?: any): Promise<T[]>;
    count(args?: any): Promise<number>;
}

/**
 * Paginate Prisma query results
 *
 * @param query - PaginateQuery from nestjs-paginate (extracted from request)
 * @param delegate - Prisma model delegate (e.g., prisma.toto)
 * @param config - Pagination configuration
 * @param baseWhere - Additional where clause to merge (e.g., tenant filtering)
 *
 * @example
 * ```typescript
 * const result = await prismaPaginate(
 *   query,
 *   this.prisma.toto,
 *   TOTO_PAGINATE_CONFIG,
 *   { tenantId: currentTenantId, deletedAt: null }
 * );
 * ```
 */
export async function prismaPaginate<T extends Record<string, any>>(
    query: PaginateQuery<T>,
    delegate: PrismaDelegate<T>,
    config: PaginateConfig<T>,
    baseWhere: Record<string, any> = {},
): Promise<Paginated<T>> {
    const {
        sortableColumns,
        defaultSortBy,
        filterableColumns = {},
        searchableColumns = [],
        defaultLimit = 10,
        maxLimit = 100,
        minLimit = 1,
    } = config;

    // Parse pagination
    const page = Math.max(1, Number(query.page) || 1);
    const rawLimit = Number(query.limit) || defaultLimit;
    const limit = Math.min(maxLimit, Math.max(minLimit, rawLimit));
    const skip = (page - 1) * limit;

    // Parse filters - extract filter params from query object
    // Handle both raw filter params and pre-parsed filter object
    const filterQuery = (query.filter as Record<string, unknown>) || {};
    const filterItems = parseFilters<T>(filterQuery, filterableColumns);
    const filterWhere = buildFilterWhere(filterItems);

    // Parse search
    const searchWhere: Record<string, unknown> = {};
    if (query.search && searchableColumns.length > 0) {
        searchWhere.OR = searchableColumns.map((column: keyof T) => ({
            [String(column)]: {
                contains: query.search,
                mode: 'insensitive',
            },
        }));
    }

    // Merge all where clauses
    const where = {
        ...baseWhere,
        ...filterWhere,
        ...searchWhere,
    };

    // Parse sort
    const orderBy = parseSort<T>(query.sortBy, sortableColumns, defaultSortBy);

    // Execute queries
    const [data, totalItems] = await Promise.all([
        delegate.findMany({
            where,
            orderBy,
            skip,
            take: limit,
        }),
        delegate.count({ where }),
    ]);

    // Build response
    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Build links (simplified - you may want to use actual request URL)
    const buildLink = (targetPage: number) => {
        const params = new URLSearchParams();
        params.set('page', String(targetPage));
        params.set('limit', String(limit));
        if (query.sortBy) {
            const sortArray = Array.isArray(query.sortBy) ? query.sortBy : [query.sortBy];
            sortArray.forEach((sort: string | [string, string]) => params.append('sortBy', String(sort)));
        }
        if (query.search) {
            params.set('search', query.search);
        }
        return `?${params.toString()}`;
    };

    return {
        data,
        meta: {
            itemsPerPage: limit,
            totalItems,
            currentPage: page,
            totalPages,
            sortBy: orderBy.map((sort) => {
                const entry = Object.entries(sort)[0];
                if (!entry) {
                    return ['', 'ASC'] as [string, string];
                }
                const [column, direction] = entry;
                return [column, direction.toUpperCase()] as [string, string];
            }),
            searchBy: searchableColumns.map(String),
            search: query.search || '',
            filter: filterItems,
        },
        links: {
            first: buildLink(1),
            previous: hasPreviousPage ? buildLink(page - 1) : '',
            current: buildLink(page),
            next: hasNextPage ? buildLink(page + 1) : '',
            last: buildLink(totalPages),
        },
    };
}
