import { BadRequestException } from '@nestjs/common';
import { CursorPaginated, CursorPaginateQuery, Edge } from './types/cursor-paginate.interface';
import { PaginateConfig } from './types/paginate-config.type';
import { parseFilters, buildFilterWhere } from './filter';
import { parseSort } from './sort';
import { createCursor, decodeCursor, buildCursorWhere } from './cursor';

/**
 * Prisma delegate with findMany and count methods
 * NOTE: `any` is intentional — structural bridge for Prisma's generated delegate types.
 */
interface PrismaDelegate<T> {
    findMany(args?: any): Promise<T[]>;
    count(args?: any): Promise<number>;
}

/**
 * Cursor-based pagination for Prisma queries
 *
 * @param query - CursorPaginateQuery from decorator
 * @param delegate - Prisma model delegate (e.g., prisma.currency)
 * @param config - Pagination configuration
 * @param baseWhere - Additional where clause (e.g., tenant filtering, soft delete)
 *
 * @example
 * ```typescript
 * const result = await prismaCursorPaginate(
 *   query,
 *   this.prisma.currency,
 *   CURRENCY_PAGINATE_CONFIG,
 *   { tenantId: currentTenantId, deletedAt: null }
 * );
 * ```
 */
export async function prismaCursorPaginate<T extends Record<string, any>>(
    query: CursorPaginateQuery<T>,
    delegate: PrismaDelegate<T>,
    config: PaginateConfig<T>,
    baseWhere: Record<string, any> = {},
): Promise<CursorPaginated<T>> {
    const {
        sortableColumns,
        defaultSortBy,
        filterableColumns = {},
        searchableColumns = [],
        defaultLimit = 10,
        maxLimit = 100,
        minLimit = 1,
        cursorColumn = 'id' as Extract<keyof T, string>,
        cursorIncludeTotalCount = false,
    } = config;

    // Determine pagination direction and limit
    const isForward = !query.before && !query.last;
    const isBackward = !!query.before || !!query.last;

    // Validate mutual exclusivity
    if (query.after && query.before) {
        throw new BadRequestException(
            'Cannot use both "after" and "before" cursors. Use "after" for forward pagination or "before" for backward pagination.',
        );
    }
    if (query.first && query.last) {
        throw new BadRequestException(
            'Cannot use both "first" and "last" parameters. Use "first" for forward pagination or "last" for backward pagination.',
        );
    }

    // Calculate limit
    const rawLimit = query.first ?? query.last ?? defaultLimit;
    const limit = Math.min(maxLimit, Math.max(minLimit, rawLimit));

    // Parse filters
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

    // Parse sort - ensure unique column is always included for deterministic ordering
    let orderBy = parseSort<T>(query.sortBy, sortableColumns, defaultSortBy);

    // Ensure cursor column is in sort for tie-breaking
    const hasCursorColumn = orderBy.some((o) => Object.keys(o)[0] === cursorColumn);
    if (!hasCursorColumn) {
        orderBy = [...orderBy, { [String(cursorColumn)]: 'asc' as const }];
    }

    // Merge base where clauses
    let where: Record<string, unknown> = {
        ...baseWhere,
        ...filterWhere,
        ...searchWhere,
    };

    // Handle cursor-based where conditions
    const cursorString = query.after || query.before;
    if (cursorString) {
        const cursorPayload = decodeCursor(cursorString);
        const cursorWhere = buildCursorWhere(cursorPayload, orderBy, isForward);
        where = { AND: [where, cursorWhere] };
    }

    // For backward pagination, reverse the sort order for the query
    const queryOrderBy = isBackward
        ? orderBy.map((o) => {
              const entry = Object.entries(o)[0];
              if (!entry) {
                  return o;
              }
              const [col, dir] = entry;
              return { [col]: dir === 'asc' ? ('desc' as const) : ('asc' as const) };
          })
        : orderBy;

    // Fetch one extra item to determine if there are more pages
    const [data, totalCount] = await Promise.all([
        delegate.findMany({
            where,
            orderBy: queryOrderBy,
            take: limit + 1, // Fetch one extra to check for more pages
        }),
        cursorIncludeTotalCount
            ? delegate.count({
                  where: { ...baseWhere, ...filterWhere, ...searchWhere },
              })
            : Promise.resolve(undefined),
    ]);

    // Check if there are more items
    const hasMore = data.length > limit;

    // Trim to requested limit
    const items = hasMore ? data.slice(0, limit) : data;

    // Reverse items if backward pagination (we queried in reverse order)
    if (isBackward) {
        items.reverse();
    }

    // Build edges with cursors
    const sortColumns = orderBy
        .map((o) => {
            const entry = Object.entries(o)[0];
            if (!entry) {
                return null;
            }
            const [column, direction] = entry;
            return { column, direction: direction as 'asc' | 'desc' };
        })
        .filter((col): col is { column: string; direction: 'asc' | 'desc' } => col !== null);

    const edges: Edge<T>[] = items.map((item) => ({
        node: item,
        cursor: createCursor(item, sortColumns, String(cursorColumn), 'f'),
    }));

    // Determine hasNextPage and hasPreviousPage
    const hasNextPage = isForward ? hasMore : !!query.before;
    const hasPreviousPage = isBackward ? hasMore : !!query.after;

    // Get first and last edges for pageInfo
    const firstEdge = edges[0];
    const lastEdge = edges[edges.length - 1];

    return {
        edges,
        pageInfo: {
            startCursor: firstEdge?.cursor ?? null,
            endCursor: lastEdge?.cursor ?? null,
            hasNextPage,
            hasPreviousPage,
        },
        totalCount,
        meta: {
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
    };
}
