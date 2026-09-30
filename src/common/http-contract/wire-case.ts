/**
 * Key-case conversion at the HTTP boundary (API Contract v1.3 §1: `snake_case` for all fields and query
 * parameters). Services and DTOs stay camelCase; the wire is snake_case. Only object keys change — values,
 * dates, buffers and decimals pass through untouched.
 */

export const toSnakeCase = (key: string): string =>
    key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
        .toLowerCase();

export const toCamelCase = (key: string): string => key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());

/** Objects whose keys are data, not structure (dates, binary, Prisma decimals, collections). */
function isOpaque(value: object): boolean {
    return (
        value instanceof Date ||
        Buffer.isBuffer(value) ||
        value instanceof Map ||
        value instanceof Set ||
        ArrayBuffer.isView(value) ||
        (typeof (value as { toFixed?: unknown }).toFixed === 'function' && typeof (value as { d?: unknown }).d !== 'undefined')
    );
}

function convertKeys(value: unknown, convert: (key: string) => string): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => convertKeys(item, convert));
    }
    if (value === null || typeof value !== 'object' || isOpaque(value)) {
        return value;
    }
    const source = typeof (value as { toJSON?: unknown }).toJSON === 'function' ? (value as { toJSON: () => unknown }).toJSON() : value;
    if (source === null || typeof source !== 'object') {
        return source;
    }
    return Object.fromEntries(Object.entries(source).map(([key, inner]) => [convert(key), convertKeys(inner, convert)]));
}

export const snakeCaseKeys = (value: unknown): unknown => convertKeys(value, toSnakeCase);
export const camelCaseKeys = (value: unknown): unknown => convertKeys(value, toCamelCase);
