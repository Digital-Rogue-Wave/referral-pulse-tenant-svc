/**
 * Filter item with operation and value
 * @typeParam T - The model type for type-safe column names
 */
export interface FilterItem<T = Record<string, any>> {
    column: Extract<keyof T, string>;
    operator: string;
    value: string | string[];
}

/**
 * Pagination query parameters with generic type support
 *
 * @typeParam T - The model type used for inference from PaginateConfig
 */
export interface PaginateQuery<T = Record<string, any>> {
    path: string;
    page?: number;
    limit?: number;
    sortBy?: [Extract<keyof T, string>, 'ASC' | 'DESC'][] | Extract<keyof T, string>[];
    searchBy?: Extract<keyof T, string>[];
    search?: string;
    filter?: FilterItem<T>[] | Record<string, any>;
    select?: Extract<keyof T, string>[];
}

/**
 * Paginated response structure with generic type support
 *
 * @typeParam T - The model type used for inference from PaginateConfig
 */
export interface Paginated<T> {
    data: T[];
    meta: {
        itemsPerPage: number;
        totalItems: number;
        currentPage: number;
        totalPages: number;
        sortBy: [string, string][];
        searchBy: string[];
        search: string;
        filter?: FilterItem<T>[];
    };
    links: {
        first?: string;
        previous?: string;
        current: string;
        next?: string;
        last?: string;
    };
}
