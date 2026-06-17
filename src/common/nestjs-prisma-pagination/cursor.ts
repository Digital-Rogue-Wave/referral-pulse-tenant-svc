import { BadRequestException } from '@nestjs/common';

import { JsonService } from '@common/helper/json.service';

import { CursorPayload } from './types/cursor-paginate.interface';

const jsonService = new JsonService();

/**
 * Serialize value for cursor (handle dates, etc.)
 */
function serializeValue(value: unknown): unknown {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return value;
}

/**
 * Encode cursor payload to URL-safe base64 string
 */
export function encodeCursor(payload: CursorPayload): string {
    const json = jsonService.stringify(payload);
    // Use URL-safe base64 encoding
    return Buffer.from(json, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode cursor string back to payload
 * @throws Error if cursor is invalid
 */
export function decodeCursor(cursor: string): CursorPayload {
    try {
        // Restore base64 padding and decode
        const padded = cursor.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((cursor.length + 3) % 4);

        const json = Buffer.from(padded, 'base64').toString('utf-8');
        const payload = jsonService.parse<CursorPayload>(json);

        // Validate required fields
        if (!payload.sv || !payload.uid || !payload.d) {
            throw new BadRequestException('Invalid cursor: cursor structure is malformed. Use the cursor value from a previous pagination response.');
        }

        return payload;
    } catch (error) {
        if (error instanceof BadRequestException) {
            throw error;
        }
        throw new BadRequestException(
            'Invalid cursor format: the cursor must be a valid opaque string from a previous pagination response. ' +
                'To get the first page, omit the "after" and "before" parameters.'
        );
    }
}

/**
 * Create cursor for an entity
 */
export function createCursor<T extends Record<string, any>>(
    entity: T,
    sortColumns: Array<{ column: string; direction: 'asc' | 'desc' }>,
    uniqueColumn: string,
    direction: 'f' | 'b'
): string {
    const payload: CursorPayload = {
        sv: sortColumns.map(({ column }) => ({
            c: column,
            v: serializeValue(entity[column])
        })),
        uid: {
            c: uniqueColumn,
            v: String(entity[uniqueColumn])
        },
        d: direction
    };

    return encodeCursor(payload);
}

/**
 * Build Prisma WHERE clause for cursor-based pagination
 * Implements the "keyset pagination" / "seek method" algorithm
 *
 * For sort [A ASC, B ASC] after cursor {A: 'a', B: 'b', uid: 'x'}:
 * WHERE (A > 'a')
 *    OR (A = 'a' AND B > 'b')
 *    OR (A = 'a' AND B = 'b' AND uid > 'x')
 */
export function buildCursorWhere(cursor: CursorPayload, orderBy: Array<Record<string, 'asc' | 'desc'>>, isForward: boolean): Record<string, unknown> {
    const conditions: Record<string, unknown>[] = [];

    // Build compound cursor condition for multi-column sort
    for (let i = 0; i < cursor.sv.length; i++) {
        const condition: Record<string, unknown> = {};

        // Add equality conditions for all previous columns
        for (let j = 0; j < i; j++) {
            const col = cursor.sv[j];
            if (col) {
                condition[col.c] = col.v;
            }
        }

        // Add inequality for current column
        const currentCol = cursor.sv[i];
        const sortEntry = orderBy[i];

        if (!currentCol || !sortEntry) {
            continue;
        }

        const sortDirection = Object.values(sortEntry)[0] as 'asc' | 'desc';

        // Determine comparison operator based on sort direction and pagination direction
        const isAscending = sortDirection === 'asc';
        const useGreaterThan = isForward ? isAscending : !isAscending;

        condition[currentCol.c] = useGreaterThan ? { gt: currentCol.v } : { lt: currentCol.v };

        conditions.push(condition);
    }

    // Add final tie-breaker condition using unique ID
    const tieBreaker: Record<string, unknown> = {};
    for (const col of cursor.sv) {
        tieBreaker[col.c] = col.v;
    }

    // Use unique ID as final tie-breaker
    const uniqueCol = cursor.uid;
    tieBreaker[uniqueCol.c] = isForward ? { gt: uniqueCol.v } : { lt: uniqueCol.v };
    conditions.push(tieBreaker);

    return { OR: conditions };
}
