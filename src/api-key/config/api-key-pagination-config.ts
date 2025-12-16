import { FilterOperator, FilterSuffix, PaginateConfig } from 'nestjs-paginate';
import { ApiKeyEntity } from '../api-key.entity';

export const apiKeyPaginationConfig: PaginateConfig<ApiKeyEntity> = {
    defaultSortBy: [['createdAt', 'DESC']],
    relations: ['tenant'],
    searchableColumns: ['expiresAt', 'name'],
    sortableColumns: ['createdAt', 'updatedAt'],
    maxLimit: 100,
    loadEagerRelations: true,
    filterableColumns: {
        expiresAt: [FilterOperator.EQ, FilterSuffix.NOT],
        name: [FilterOperator.EQ, FilterSuffix.NOT]
    }
};
