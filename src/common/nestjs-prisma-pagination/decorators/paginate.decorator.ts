import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PaginateQuery } from '../types/paginate-query.interface';

/**
 * Decorator to extract pagination parameters from the request
 * Returns a PaginateQuery object
 *
 * Usage:
 * @Get()
 * findAll(@Paginate() query: PaginateQuery) { ... }
 */
export const Paginate = createParamDecorator((_data: unknown, ctx: ExecutionContext): PaginateQuery => {
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
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        sortBy: query.sortBy ? (Array.isArray(query.sortBy) ? query.sortBy : [query.sortBy]) : undefined,
        searchBy: query.searchBy ? (Array.isArray(query.searchBy) ? query.searchBy : [query.searchBy]) : undefined,
        search: query.search,
        filter: filterParams,
        select: query.select ? (Array.isArray(query.select) ? query.select : [query.select]) : undefined,
    };
});
