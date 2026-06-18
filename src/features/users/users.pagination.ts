import type { UserProps } from '@domains/user';
import { PaginateConfig, FilterOperator } from '@common/nestjs-prisma-pagination';

/**
 * Pagination configuration for the platform users list endpoint.
 */
export const USER_PAGINATE_CONFIG: PaginateConfig<UserProps> = {
    sortableColumns: ['id', 'role', 'createdAt', 'updatedAt'],
    defaultSortBy: [['createdAt', 'DESC']],
    filterableColumns: {
        role: [FilterOperator.EQ, FilterOperator.IN],
        email: [FilterOperator.EQ]
    },
    defaultLimit: 10,
    maxLimit: 100
};
