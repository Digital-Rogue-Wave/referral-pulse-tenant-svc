import type { Plan } from '@prisma-gen/generated/client';
import { PaginateConfig, FilterOperator } from '@common/nestjs-prisma-pagination';

/**
 * Pagination configuration for Plan list endpoint
 */
export const PLAN_PAGINATE_CONFIG: PaginateConfig<Plan> = {
    sortableColumns: ['name', 'createdAt', 'isActive'],
    defaultSortBy: [['createdAt', 'ASC']],
    filterableColumns: {
        name: [FilterOperator.EQ, FilterOperator.CONTAINS],
        isActive: [FilterOperator.EQ],
        tenantId: [FilterOperator.EQ],
        manualInvoicing: [FilterOperator.EQ]
    },
    searchableColumns: ['name'],
    defaultLimit: 20,
    maxLimit: 100
};
