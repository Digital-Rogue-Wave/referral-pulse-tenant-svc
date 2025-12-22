import { FilterOperator, FilterSuffix, PaginateConfig } from 'nestjs-paginate';
import { PlanEntity } from '../plan.entity';

export const planPaginationConfig: PaginateConfig<PlanEntity> = {
    defaultSortBy: [['createdAt', 'DESC']],
    relations: [],
    searchableColumns: ['name', 'stripePriceId', 'stripeProductId', 'interval'],
    sortableColumns: ['createdAt', 'updatedAt', 'name'],
    maxLimit: 100,
    loadEagerRelations: true,
    filterableColumns: {
        tenantId: [FilterOperator.EQ, FilterSuffix.NOT],
        isActive: [FilterOperator.EQ],
        manualInvoicing: [FilterOperator.EQ]
    }
};
