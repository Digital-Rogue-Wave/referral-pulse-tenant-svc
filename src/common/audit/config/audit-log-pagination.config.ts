import { FilterOperator, FilterSuffix, PaginateConfig } from 'nestjs-paginate';
import { AuditLogEntity } from '../audit-log.entity';

export const auditLogPaginationConfig: PaginateConfig<AuditLogEntity> = {
    defaultSortBy: [['createdAt', 'DESC']],
    relations: [],
    searchableColumns: ['action'],
    sortableColumns: ['createdAt', 'updatedAt'],
    maxLimit: 100,
    loadEagerRelations: true,
    filterableColumns: {
        action: [FilterOperator.EQ, FilterSuffix.NOT]
    }
};
