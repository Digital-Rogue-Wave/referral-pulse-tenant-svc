import { instanceToPlain, plainToInstance } from 'class-transformer';

import { CursorPaginated, PageInfo } from './types/cursor-paginate.interface';

export class CursorPaginatedDto<T, V> {
    edges: Array<{ node: V; cursor: string }>;
    pageInfo: PageInfo;
    totalCount?: number;
    meta: CursorPaginated<T>['meta'];

    constructor(data: CursorPaginated<T>, dto: new () => V) {
        this.pageInfo = data.pageInfo;
        this.totalCount = data.totalCount;
        this.meta = data.meta;
        this.edges = data.edges.map((edge) => ({
            node: plainToInstance(dto, instanceToPlain(edge.node), {
                excludeExtraneousValues: true
            }),
            cursor: edge.cursor
        }));
    }
}
