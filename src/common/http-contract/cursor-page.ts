import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

/**
 * List query (API Contract v1.3 §1 "Pagination & Filtering"): `limit`, `starting_after`, `ending_before`.
 * Cursors are resource ids — ULIDs are time-ordered, so the id is a stable, opaque position.
 */
export class ListQueryDto {
    @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: DEFAULT_PAGE_LIMIT })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_PAGE_LIMIT)
    limit?: number;

    @ApiPropertyOptional({ description: 'Return items after this id (next page)' })
    @IsOptional()
    @IsString()
    @Length(1, 64)
    startingAfter?: string;

    @ApiPropertyOptional({ description: 'Return items before this id (previous page)' })
    @IsOptional()
    @IsString()
    @Length(1, 64)
    endingBefore?: string;
}

/** Response envelope `{ data, has_more, next_cursor, prev_cursor }` (snake-cased on the wire). */
export class CursorPage<T> {
    @ApiProperty({ isArray: true })
    data!: T[];

    @ApiProperty()
    hasMore!: boolean;

    @ApiPropertyOptional({ nullable: true, type: String })
    nextCursor!: string | null;

    @ApiPropertyOptional({ nullable: true, type: String })
    prevCursor!: string | null;
}

interface CursorDelegate<Row> {
    findMany(args: { where: object; orderBy: { id: 'asc' | 'desc' }; take: number }): Promise<Row[]>;
}

/**
 * Newest-first page of `delegate` rows matching `where`. Fetches one extra row to know whether more exist,
 * so a page is one query and never counts the table.
 */
export async function cursorPage<Row extends { id: string }, Item>(
    delegate: CursorDelegate<Row>,
    where: object,
    query: ListQueryDto,
    toItem: (row: Row) => Item
): Promise<CursorPage<Item>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const backward = !query.startingAfter && !!query.endingBefore;
    const cursorFilter = query.startingAfter ? { id: { lt: query.startingAfter } } : query.endingBefore ? { id: { gt: query.endingBefore } } : {};

    const rows = await delegate.findMany({
        where: { AND: [where, cursorFilter] },
        orderBy: { id: backward ? 'asc' : 'desc' },
        take: limit + 1
    });
    const more = rows.length > limit;
    const pageRows = (more ? rows.slice(0, limit) : rows).sort((a, b) => (a.id < b.id ? 1 : -1));

    const first = pageRows[0]?.id ?? null;
    const last = pageRows.at(-1)?.id ?? null;
    // `has_more` is about the direction being paged (Stripe semantics). Older items always exist behind an
    // `ending_before` page (the cursor row itself), and newer ones in front of a `starting_after` page.
    const olderExist = backward ? true : more;
    const newerExist = backward ? more : !!query.startingAfter;
    return {
        data: pageRows.map(toItem),
        hasMore: more,
        nextCursor: olderExist ? last : null,
        prevCursor: newerExist ? first : null
    };
}
