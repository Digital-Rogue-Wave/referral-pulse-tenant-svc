import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { DeleteResult, FindOptionsRelations, FindOptionsSelect, FindOptionsWhere } from 'typeorm';
import { NullableType } from '@mod/types/nullable.type';

export interface BaseService<T> {
    list(query: PaginateQuery): Promise<Paginated<T>>;
    create(resource: any, options?: any): Promise<T>;
    updateById(id: string | number, resource: any): Promise<T>;
    readOneOrFail(fields: FindOptionsWhere<T>, relations?: FindOptionsRelations<T>, select?: FindOptionsSelect<T>): Promise<T>;
    readOne(fields: FindOptionsWhere<T>, relations?: FindOptionsRelations<T>, select?: FindOptionsSelect<T>): Promise<NullableType<T>>;
    deleteById(id: number | string): Promise<DeleteResult>;
    getTotal(find?: Record<string, any>): Promise<number>;
}
