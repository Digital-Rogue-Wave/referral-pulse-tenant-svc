import { Paginated, PaginateQuery } from '../nestjs-prisma-pagination';

import { NullableType } from '@app/types';

export interface BaseService<
    T,
    CreateDto = Partial<T>,
    UpdateDto = Partial<T>,
    WhereUniqueDto extends object = Record<string, unknown>,
    FindManyArgsDto extends object = Record<string, unknown>,
> {
    list(query: PaginateQuery<T>): Promise<Paginated<T>>;
    listUnpaginated(options?: FindManyArgsDto): Promise<T[]>;
    create(resource: CreateDto, options?: Record<string, unknown>): Promise<T>;
    updateById(id: string | number, resource: UpdateDto): Promise<T>;
    readOneOrFail(fields: WhereUniqueDto): Promise<T>;
    readOne(fields: WhereUniqueDto): Promise<NullableType<T>>;
    deleteById(id: number | string): Promise<T>;
    getTotal(find?: WhereUniqueDto): Promise<number>;
}
