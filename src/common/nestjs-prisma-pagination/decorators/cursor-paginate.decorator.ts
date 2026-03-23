import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CursorPaginateQuery } from '../types/cursor-paginate.interface';

/**
 * Decorator to extract cursor pagination parameters from the request
 * Returns a CursorPaginateQuery object
 *
 * Usage:
 * @Get('cursor')
 * findAllCursor(@CursorPaginate() query: CursorPaginateQuery) { ... }
 */
export const CursorPaginate = createParamDecorator((_data: unknown, ctx: ExecutionContext): CursorPaginateQuery => {
    const request = ctx.switchToHttp().getRequest();
    const { query } = request;

    // Parse path (removing query string)
    const path = request.url.split('?')[0];

    // Extract filter from query - the entire query object is passed to parseFilters
    // which will look for keys starting with 'filter' or 'filter['
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filterParams: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
        if (key.startsWith('filter') || key.startsWith('filter[')) {
            filterParams[key] = value;
        }
    }

    return {
        path,
        after: query.after,
        before: query.before,
        first: query.first ? parseInt(query.first, 10) : undefined,
        last: query.last ? parseInt(query.last, 10) : undefined,
        sortBy: query.sortBy ? (Array.isArray(query.sortBy) ? query.sortBy : [query.sortBy]) : undefined,
        searchBy: query.searchBy ? (Array.isArray(query.searchBy) ? query.searchBy : [query.searchBy]) : undefined,
        search: query.search,
        filter: filterParams,
        select: query.select ? (Array.isArray(query.select) ? query.select : [query.select]) : undefined,
    };
});
