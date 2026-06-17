import { PaginateConfig, Paginated, PaginateQuery, CursorPaginated, CursorPaginateQuery } from '../nestjs-prisma-pagination';

export class PaginateMockUtils {
    static query: PaginateQuery = { path: '' };

    static config<T>(): PaginateConfig<T> {
        return {
            sortableColumns: ['id' as Extract<keyof T, string>],
            defaultSortBy: [['id' as Extract<keyof T, string>, 'ASC']],
            defaultLimit: 1
        };
    }

    static paginatedData<T>(data: T[]): Paginated<T> {
        return {
            meta: {
                itemsPerPage: 10,
                totalItems: data.length,
                currentPage: 1,
                totalPages: 1,
                sortBy: [['id', 'ASC']] as [string, string][],
                searchBy: [],
                search: ''
            },
            data: data,
            links: {
                current: ''
            }
        };
    }

    /**
     * Create a mock cursor pagination query
     */
    static cursorQuery<T>(): CursorPaginateQuery<T> {
        return { path: '' };
    }

    /**
     * Create mock cursor paginated data
     */
    static cursorPaginatedData<T>(data: T[]): CursorPaginated<T> {
        return {
            edges: data.map((item, index) => ({
                node: item,
                cursor: `cursor_${index}`
            })),
            pageInfo: {
                startCursor: data.length > 0 ? 'cursor_0' : null,
                endCursor: data.length > 0 ? `cursor_${data.length - 1}` : null,
                hasNextPage: false,
                hasPreviousPage: false
            },
            meta: {
                sortBy: [['id', 'ASC']] as [string, string][],
                searchBy: [],
                search: ''
            }
        };
    }
}
