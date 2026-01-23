import { PaginateConfig } from 'nestjs-paginate';
import { TotoEntity } from '../toto.entity';

/**
 * Pagination configuration for Toto entity
 *
 * Defines which fields can be sorted, filtered, and searched
 * Centralizes pagination rules for consistency across the application
 *
 * Usage:
 * ```typescript
 * const result = await paginate(query, queryBuilder, TOTO_PAGINATE_CONFIG);
 * ```
 *
 * Query examples:
 * - Pagination: ?page=1&limit=10
 * - Sorting: ?sortBy=name:ASC&sortBy=createdAt:DESC
 * - Filtering: ?filter.status=active
 * - Search: ?search=keyword (searches in name and description)
 * - Combined: ?page=2&limit=20&sortBy=name:ASC&filter.status=active&search=test
 */
export const TOTO_PAGINATE_CONFIG: PaginateConfig<TotoEntity> = {
    /**
     * Columns that can be used for sorting
     */
    sortableColumns: ['id', 'name', 'status', 'createdAt', 'updatedAt'],

    /**
     * Default sort order when none is specified
     */
    defaultSortBy: [['createdAt', 'DESC']],

    /**
     * Columns that can be searched with full-text search
     * Search query: ?search=keyword
     */
    searchableColumns: ['name', 'description'],

    /**
     * Columns that can be filtered with exact match
     * Filter query: ?filter.status=active
     */
    filterableColumns: {
        status: true,
        name: true,
    },

    /**
     * Default number of items per page
     */
    defaultLimit: 10,

    /**
     * Maximum number of items per page (prevents abuse)
     */
    maxLimit: 100,
};