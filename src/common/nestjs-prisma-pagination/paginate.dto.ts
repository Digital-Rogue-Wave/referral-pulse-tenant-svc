import { instanceToPlain, plainToInstance } from 'class-transformer';

import { Paginated } from './types/paginate-query.interface';

export class PaginatedDto<T, V> {
    data: V[];
    meta: Paginated<T>['meta'];
    links: Paginated<T>['links'];

    constructor(data: Paginated<T>, dto: new () => V) {
        this.meta = data.meta;
        this.links = data.links;
        this.data = data.data.map((item: T) =>
            plainToInstance(dto, instanceToPlain(item), {
                excludeExtraneousValues: true,
            }),
        );
    }
}
