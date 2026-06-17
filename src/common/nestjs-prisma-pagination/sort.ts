/**
 * Parse sort query parameters into Prisma orderBy clause
 *
 * @example
 * // ?sortBy=name:ASC&sortBy=createdAt:DESC
 * parseSort(['name:ASC', 'createdAt:DESC'], ['name', 'createdAt'])
 * // Returns: [{ name: 'asc' }, { createdAt: 'desc' }]
 */
export function parseSort<T>(
    sortBy: string | string[] | [string, string][] | undefined,
    sortableColumns: Array<keyof T>,
    defaultSortBy?: Array<[keyof T, 'ASC' | 'DESC']>
): Array<Record<string, 'asc' | 'desc'>> {
    const orderBy: Array<Record<string, 'asc' | 'desc'>> = [];

    // Use default if no sort specified
    if (!sortBy && defaultSortBy) {
        return defaultSortBy.map(([column, direction]) => ({
            [String(column)]: direction.toLowerCase() as 'asc' | 'desc'
        }));
    }

    // Normalize to array
    const sortArray = Array.isArray(sortBy) ? sortBy : sortBy ? [sortBy] : [];

    for (const sortItem of sortArray) {
        let columnName: keyof T;
        let direction: string;

        if (Array.isArray(sortItem)) {
            const [col, dir] = sortItem as unknown as [keyof T, string];
            columnName = col;
            direction = dir;
        } else {
            const [col, dir = 'ASC'] = sortItem.split(':');
            columnName = col as keyof T;
            direction = dir;
        }

        // Only allow sorting on sortable columns
        if (!sortableColumns.includes(columnName)) {
            continue;
        }

        orderBy.push({
            [String(columnName)]: direction.toLowerCase() as 'asc' | 'desc'
        });
    }

    return orderBy.length > 0
        ? orderBy
        : defaultSortBy
          ? defaultSortBy.map(([column, direction]) => ({
                [String(column)]: direction.toLowerCase() as 'asc' | 'desc'
            }))
          : [];
}
