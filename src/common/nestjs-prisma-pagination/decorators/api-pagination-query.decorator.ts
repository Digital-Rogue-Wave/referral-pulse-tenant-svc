import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { PaginateConfig } from '../types/paginate-config.type';
import { FilterOperator } from '../filter-operator.enum';

/**
 * Metadata key for storing pagination config
 */
export const PAGINATION_CONFIG_KEY = 'paginationConfig';

/**
 * Type for filter parameter format
 */
interface FilterParam {
    [key: string]: string | string[];
}

/**
 * Creates Swagger/OpenAPI documentation for pagination query parameters
 *
 * @param config - Pagination configuration with sortable/filterable columns
 *
 * Usage:
 * @ApiPaginationQuery(CURRENCY_PAGINATE_CONFIG)
 * @Get()
 * findAll(@Paginate() query: PaginateQuery) { ... }
 */
export function ApiPaginationQuery<T>(config: PaginateConfig<T>): ReturnType<typeof applyDecorators> {
    const decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator> = [SetMetadata(PAGINATION_CONFIG_KEY, config)];

    // Page parameter (required for pagination)
    decorators.push(
        ApiQuery({
            name: 'page',
            description: 'Page number (1-indexed)',
            required: false,
            schema: {
                type: 'integer',
                minimum: 1,
                default: 1
            },
            example: 1
        })
    );

    // Limit parameter
    const defaultLimit = config.defaultLimit ?? 10;
    const maxLimit = config.maxLimit ?? 100;

    decorators.push(
        ApiQuery({
            name: 'limit',
            description: `Number of items per page (max: ${maxLimit})`,
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
            schema: {
                type: 'string'
            },
            example: 'search term'
        })
    );

    decorators.push(
        ApiQuery({
            name: 'searchBy',
            description: 'Columns to search in (if not specified, searches all searchable columns)',
            required: false,
            schema: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            example: config.searchableColumns ? config.searchableColumns.map(String) : ['name', 'code'],
            explode: false
        })
    );

    // Filter parameter - only if filterable columns are defined
    if (config.filterableColumns && Object.keys(config.filterableColumns).length > 0) {
        const filterableColumnsStr = Object.keys(config.filterableColumns).join(', ');

        // Build dynamic example based on filterable columns and their allowed operators
        const example: Record<string, string[]> = {};
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

        // Generate example filter keys based on actual filterable columns
        for (const [column, operators] of Object.entries(config.filterableColumns)) {
            if (operators && Array.isArray(operators) && operators.length > 0) {
                // Use the first operator for the example
                const operator = operators[0];
                const exampleValue = operatorExamples[operator] || 'value';
                example[`${column}[${operator}]`] = [exampleValue];
            }
        }

        // List all available operators in description
        const allOperators = Object.keys(operatorExamples).join(', ');

        // Build dynamic schema properties based on filterable columns
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
 * Helper function to get the pagination config from the decorator
 * Can be used in guards or interceptors to access the config
 */
export function getPaginationConfig<T>(target: object): PaginateConfig<T> | undefined {
    return Reflect.getMetadata(PAGINATION_CONFIG_KEY, target);
}
