import { FilterOperator, FilterSuffix, PaginateConfig } from 'nestjs-paginate';
import { TenantSettingEntity } from '@mod/tenant-setting/tenant-setting.entity';

export const tenantSettingPaginationConfig: PaginateConfig<TenantSettingEntity> = {
    defaultSortBy: [['createdAt', 'DESC']],
    relations: ['tenant'],
    searchableColumns: ['tenant.id'],
    sortableColumns: ['createdAt', 'updatedAt'],
    maxLimit: 100,
    loadEagerRelations: true,
    filterableColumns: {
        createdAt: [FilterOperator.EQ, FilterSuffix.NOT]
    }
};
