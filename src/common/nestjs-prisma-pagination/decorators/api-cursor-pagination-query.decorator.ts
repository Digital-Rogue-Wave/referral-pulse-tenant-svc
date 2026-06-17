import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { PaginateConfig } from '../types/paginate-config.type';

/**
 * Metadata key for storing cursor pagination config
 */
export const CURSOR_PAGINATION_CONFIG_KEY = 'cursorPaginationConfig';

/**
 * Creates Swagger/OpenAPI documentation for cursor pagination query parameters
 *
 * @param config - Pagination configuration with sortable/filterable columns
 *
 * Usage:
 * @ApiCursorPaginationQuery(CURRENCY_PAGINATE_CONFIG)
 * @Get('cursor')
 * findAllCursor(@CursorPaginate() query: CursorPaginateQuery) { ... }
 */
export function ApiCursorPaginationQuery<T>(config: PaginateConfig<T>): ReturnType<typeof applyDecorators> {
    const decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator> = [SetMetadata(CURSOR_PAGINATION_CONFIG_KEY, config)];

    // After cursor (forward pagination)
    decorators.push(
        ApiQuery({
            name: 'after',
            description: 'Cursor for forward pagination. Returns items after this cursor.',
            required: false,
            schema: { type: 'string' },
            example: 'eyJzdiI6W3siYyI6Im5hbWUiLCJ2IjoiVVNEIn1dLCJ1aWQiOnsiYyI6ImNvZGUiLCJ2IjoiVVNEIn0sImQiOiJmIn0'
        })
    );

    // Before cursor (backward pagination)
    decorators.push(
        ApiQuery({
            name: 'before',
            description: 'Cursor for backward pagination. Returns items before this cursor.',
            required: false,
            schema: { type: 'string' }
        })
    );

    // First (forward limit)
    const defaultLimit = config.defaultLimit ?? 10;
    const maxLimit = config.maxLimit ?? 100;

    decorators.push(
        ApiQuery({
            name: 'first',
            description: `Number of items to return when paginating forward (max: ${maxLimit})`,
            required: false,
            schema: {
                type: 'integer',
                minimum: 1,
                maximum: maxLimit,
                default: defaultLimit
            },
            example: defaultLimit
        })
    );

    // Last (backward limit)
    decorators.push(
        ApiQuery({
            name: 'last',
            description: `Number of items to return when paginating backward (max: ${maxLimit})`,
            required: false,
            schema: {
                type: 'integer',
                minimum: 1,
                maximum: maxLimit
            }
        })
    );

    // SortBy parameter - only if sortable columns are defined
    if (config.sortableColumns && config.sortableColumns.length > 0) {
        const sortableColumnsStr = config.sortableColumns.join(', ');
        const defaultSort = config.defaultSortBy
            ? config.defaultSortBy.map(([col, dir]) => `${String(col)}:${dir}`).join(',')
            : `${String(config.sortableColumns[0])}:ASC`;

        decorators.push(
            ApiQuery({
                name: 'sortBy',
                description: `Sort by field and direction (e.g., name:ASC). Available columns: ${sortableColumnsStr}`,
                required: false,
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                        pattern: '^[a-zA-Z_]+:(ASC|DESC)$'
                    },
                    default: [defaultSort]
                },
                example: [defaultSort],
                explode: false
            })
        );
    }

    // Search parameters
    decorators.push(
        ApiQuery({
            name: 'search',
            description: 'Full-text search query',
            required: false,
            schema: { type: 'string' }
        })
    );

    decorators.push(
        ApiQuery({
            name: 'searchBy',
            description: 'Columns to search in (if not specified, searches all searchable columns)',
            required: false,
            schema: {
                type: 'array',
                items: { type: 'string' }
            },
            example: config.searchableColumns ? config.searchableColumns.map(String) : ['name', 'code'],
            explode: false
        })
    );

    // Filter parameter - only if filterable columns are defined
    if (config.filterableColumns && Object.keys(config.filterableColumns).length > 0) {
        const filterableColumnsStr = Object.keys(config.filterableColumns).join(', ');

        const operatorExamples: Record<string, string> = {
            $eq: 'value',
            $not: 'value',
            $null: 'true',
            $not_null: 'true',
            $gt: '100',
            $gte: '100',
            $lt: '100',
            $lte: '100',
            $btw: '1,100',
            $not_btw: '1,100',
            $in: 'USD,EUR,GBP',
            $not_in: 'USD,EUR,GBP',
            $contains: 'United',
            $not_contains: 'United',
            $sw: 'Uni',
            $not_sw: 'Uni',
            $ends: 'ted',
            $not_ends: 'ted',
            $ilike: 'unit'
        };

        const allOperators = Object.keys(operatorExamples).join(', ');

        const schemaProperties: Record<string, { type: string; items?: { type: string }; example?: string }> = {};
        for (const [column, operators] of Object.entries(config.filterableColumns)) {
            if (operators && Array.isArray(operators) && operators.length > 0) {
                const operator = operators[0];
                const exampleValue = operatorExamples[operator] || 'value';
                schemaProperties[`${column}[${operator}]`] = {
                    type: 'array',
                    items: { type: 'string' },
                    example: exampleValue
                };
            }
        }

        decorators.push(
            ApiQuery({
                name: 'filter',
                description: `Filter by column values. Format: column[operator]=value. Available columns: ${filterableColumnsStr}. Operators: ${allOperators}`,
                required: false,
                schema: {
                    type: 'object',
                    properties: schemaProperties
                },
                style: 'deepObject',
                explode: true
            })
        );
    }

    return applyDecorators(...decorators);
}

/**
 * Helper function to get the cursor pagination config from the decorator
 * Can be used in guards or interceptors to access the config
 */
export function getCursorPaginationConfig<T>(target: object): PaginateConfig<T> | undefined {
    return Reflect.getMetadata(CURSOR_PAGINATION_CONFIG_KEY, target);
}
