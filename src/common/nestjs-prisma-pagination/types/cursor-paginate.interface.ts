import { FilterItem } from './paginate-query.interface';

/**
 * Internal cursor payload structure (not exposed to clients)
 * Uses short keys for compact encoding
 */
export interface CursorPayload {
    /** Sort column values in order */
    sv: Array<{ c: string; v: unknown }>;
    /** Unique identifier for tie-breaking */
    uid: { c: string; v: string };
    /** Cursor direction: 'f' = forward, 'b' = backward */
    d: 'f' | 'b';
}

/**
 * Cursor pagination query parameters
 * @typeParam T - The model type for type-safe column names
 */
export interface CursorPaginateQuery<T = Record<string, any>> {
    /** Request path */
    path: string;
    /** Cursor for forward pagination (get items after this cursor) */
    after?: string;
    /** Cursor for backward pagination (get items before this cursor) */
    before?: string;
    /** Number of items to return when paginating forward (default: config.defaultLimit) */
    first?: number;
    /** Number of items to return when paginating backward */
    last?: number;
    /** Sort columns and directions */
    sortBy?: [Extract<keyof T, string>, 'ASC' | 'DESC'][] | Extract<keyof T, string>[];
    /** Columns to search in */
    searchBy?: Extract<keyof T, string>[];
    /** Search query string */
    search?: string;
    /** Filter items */
    filter?: FilterItem<T>[] | Record<string, any>;
    /** Fields to select */
    select?: Extract<keyof T, string>[];
}

/**
 * Edge in connection pattern (wraps each item with its cursor)
 * @typeParam T - The model type
 */
export interface Edge<T> {
    /** The actual data item */
    node: T;
    /** Opaque cursor for this item */
    cursor: string;
}

/**
 * Page info for cursor-based pagination
 */
export interface PageInfo {
    /** Cursor of the first item in results */
    startCursor: string | null;
    /** Cursor of the last item in results */
    endCursor: string | null;
    /** Whether there are more items after endCursor */
    hasNextPage: boolean;
    /** Whether there are more items before startCursor */
    hasPreviousPage: boolean;
}

/**
 * Cursor-paginated response (Connection pattern)
 * @typeParam T - The model type
 */
export interface CursorPaginated<T> {
    /** Array of edges (nodes with cursors) */
    edges: Edge<T>[];
    /** Pagination metadata */
    pageInfo: PageInfo;
    /** Total count (optional - requires additional query) */
    totalCount?: number;
    /** Applied filters and sort metadata */
    meta: {
        sortBy: [string, string][];
        searchBy: string[];
        search: string;
        filter?: FilterItem<T>[];
    };
}
