import { FilterOperator } from '../filter-operator.enum';

/**
 * Prisma-compatible pagination configuration
 * Mirrors nestjs-paginate's PaginateConfig for consistency
 */
export interface PaginateConfig<T> {
    /**
     * Columns that can be used for sorting
     */
    sortableColumns: Array<Extract<keyof T, string>>;

    /**
     * Default sort order when none is specified
     */
    defaultSortBy?: Array<[Extract<keyof T, string>, 'ASC' | 'DESC']>;

    /**
     * Columns that can be filtered
     * Maps column name to allowed filter operators
     */
    filterableColumns?: Partial<Record<Extract<keyof T, string>, FilterOperator[]>>;

    /**
     * Columns that can be searched (full-text search)
     */
    searchableColumns?: Array<Extract<keyof T, string>>;

    /**
     * Default number of items per page
     */
    defaultLimit?: number;

    /**
     * Maximum number of items per page (prevents abuse)
     */
    maxLimit?: number;

    /**
     * Minimum number of items per page
     */
    minLimit?: number;

    /**
     * Unique column used for cursor pagination tie-breaking
     * Must be a unique, non-nullable column (typically 'id')
     * @default 'id'
     */
    cursorColumn?: Extract<keyof T, string>;

    /**
     * Whether to include total count in cursor pagination responses
     * Adds an extra COUNT query - disable for large datasets
     * @default false
     */
    cursorIncludeTotalCount?: boolean;
}
