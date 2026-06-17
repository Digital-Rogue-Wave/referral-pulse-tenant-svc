import { FilterOperator } from './filter-operator.enum';
import { FilterItem } from './types/paginate-query.interface';

/**
 * Parse filter query parameters into Prisma where clause
 *
 * Supports operators: EQ, CONTAINS, GT, GTE, LT, LTE, IN, NOT
 *
 * Supports two query parameter formats:
 * 1. Deep object format (with style: 'deepObject'): filter[columnName][operator]=value
 * 2. Dot notation format: filter.columnName[operator]=value or filter.columnName=value
 *
 * @example
 * // Deep object format: ?filter[code][$eq]=USD
 * // Dot notation: ?filter.code=$eq:USD or ?filter.code=USD
 * parseFilters({ 'filter[code][$eq]': 'USD' }, { code: [FilterOperator.EQ] })
 * // Returns: [{ column: 'code', operator: '$eq', value: 'USD' }]
 */
export function parseFilters<T>(
    query: Record<string, unknown>,
    filterableColumns: Partial<Record<Extract<keyof T, string>, FilterOperator[]>>
): FilterItem<T>[] {
    const filters: FilterItem<T>[] = [];

    for (const [key, value] of Object.entries(query)) {
        // Skip if not a filter key
        if (!key.startsWith('filter') && !key.startsWith('filter[')) {
            continue;
        }

        // Parse the filter key to extract column name and operator
        // First parse as string (runtime), then validate against filterableColumns
        let rawColumnName: string;
        let rawOperator: string | undefined;

        // Handle deep object format: filter[columnName][operator] or filter[columnName]
        // Also handles: filter[columnName[operator]] (nested brackets format)
        if (key.includes('[')) {
            // Try format: filter[columnName][operator]
            let match = key.match(/^filter\[([^\]]+)\]\[(\$?\w+)\]$/);
            if (match) {
                rawColumnName = match[1] ?? '';
                rawOperator = match[2];
            } else {
                // Try format: filter[columnName[operator]] (nested brackets)
                match = key.match(/^filter\[([^[]+)\[(\$?\w+)\]\]$/);
                if (match) {
                    rawColumnName = match[1] ?? '';
                    rawOperator = match[2];
                } else {
                    // Try format: filter[columnName] (no operator)
                    match = key.match(/^filter\[([^\]]+)\]$/);
                    if (match) {
                        rawColumnName = match[1] ?? '';
                        rawOperator = undefined;
                    } else {
                        continue;
                    }
                }
            }
        }
        // Handle dot notation format: filter.columnName or filter.columnName[operator]
        else if (key.startsWith('filter.')) {
            const parts = key.replace('filter.', '').split('[');
            rawColumnName = parts[0] || '';
            rawOperator = parts[1]?.replace(']', '');
        } else {
            continue;
        }

        // Validate columnName is a valid key of T via filterableColumns
        if (!rawColumnName || !(rawColumnName in filterableColumns)) {
            continue;
        }

        // After validation, assert columnName is a valid keyof T
        const columnName = rawColumnName as Extract<keyof T, string>;
        const allowedOperators = filterableColumns[columnName];
        if (!allowedOperators) {
            continue;
        }

        // Parse operator from value if not specified in key (e.g., "$contains:test")
        let filterValue = value;
        let parsedOperator: string | undefined = rawOperator;

        if (!parsedOperator && typeof value === 'string' && value.startsWith('$')) {
            // Format: $operator:value
            const valueMatch = value.match(/^(\$\w+):(.+)$/);
            if (valueMatch) {
                parsedOperator = valueMatch[1];
                filterValue = valueMatch[2];
            }
        }

        // Default to EQ if no operator specified
        if (!parsedOperator) {
            parsedOperator = FilterOperator.EQ;
        }

        // Validate operator is allowed for this column
        const operatorStr = parsedOperator.startsWith('$') ? parsedOperator : `$${parsedOperator}`;
        const prismaOperator = operatorStr as FilterOperator;

        if (!allowedOperators.includes(prismaOperator)) {
            continue;
        }

        // Convert value to appropriate format based on operator
        let filterItemValue: string | string[];

        switch (prismaOperator) {
            case FilterOperator.IN:
            case FilterOperator.NOT_IN:
                filterItemValue = String(filterValue).split(',');
                break;
            case FilterOperator.BTW:
            case FilterOperator.NOT_BTW:
                filterItemValue = String(filterValue).split(',');
                break;
            default:
                filterItemValue = String(filterValue);
        }

        filters.push({
            column: columnName,
            operator: operatorStr,
            value: filterItemValue
        } as FilterItem<T>);
    }

    return filters;
}

/**
 * Build Prisma where clause from FilterItem array
 */
export function buildFilterWhere<T = unknown>(filters: FilterItem<T>[]): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    for (const filter of filters) {
        const { column, operator, value } = filter;
        const prismaOperator = operator as FilterOperator;

        switch (prismaOperator) {
            case FilterOperator.EQ:
                where[column as string] = value;
                break;
            case FilterOperator.NOT:
                where[column as string] = { not: value };
                break;
            case FilterOperator.CONTAINS:
            case FilterOperator.ILIKE:
                where[column as string] = { contains: value, mode: 'insensitive' };
                break;
            case FilterOperator.GT:
                where[column as string] = { gt: value };
                break;
            case FilterOperator.GTE:
                where[column as string] = { gte: value };
                break;
            case FilterOperator.LT:
                where[column as string] = { lt: value };
                break;
            case FilterOperator.LTE:
                where[column as string] = { lte: value };
                break;
            case FilterOperator.IN:
                where[column as string] = { in: value };
                break;
            case FilterOperator.NOT_IN:
                where[column as string] = { notIn: value };
                break;
            case FilterOperator.NULL:
                where[column as string] = null;
                break;
            case FilterOperator.NOT_NULL:
                where[column as string] = { not: null };
                break;
            case FilterOperator.BTW: {
                const values = value as string[];
                where[column as string] = { gte: values[0], lte: values[1] };
                break;
            }
            case FilterOperator.NOT_BTW: {
                const values = value as string[];
                where[column as string] = { not: { gte: values[0], lte: values[1] } };
                break;
            }
            case FilterOperator.STARTS_WITH:
                where[column as string] = { startsWith: value, mode: 'insensitive' };
                break;
            case FilterOperator.NOT_STARTS_WITH:
                where[column as string] = {
                    not: { startsWith: value, mode: 'insensitive' }
                };
                break;
            case FilterOperator.ENDS_WITH:
                where[column as string] = { endsWith: value, mode: 'insensitive' };
                break;
            case FilterOperator.NOT_ENDS_WITH:
                where[column as string] = {
                    not: { endsWith: value, mode: 'insensitive' }
                };
                break;
        }
    }

    return where;
}
