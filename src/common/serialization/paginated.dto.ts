import { OmitType } from '@nestjs/swagger';
import { Paginated } from 'nestjs-paginate';
import { Mapper, ModelIdentifier } from '@automapper/core';

export class PaginatedDto<T, V> extends OmitType(Paginated, ['data'] as const) {
    data: V[];

    constructor(mapper: Mapper, data: Paginated<T>, model: ModelIdentifier<T>, dto: ModelIdentifier<V>) {
        super();
        Object.assign(this, data);
        this.data = mapper.mapArray(data.data, model, dto);
    }
}
