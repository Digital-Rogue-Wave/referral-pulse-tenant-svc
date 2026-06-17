import type { ApiKeyProps } from '@domains/api-key';
import { PaginateConfig, FilterOperator } from '@common/nestjs-prisma-pagination';

/**
 * Pagination configuration for API Key list endpoint
 */
export const API_KEY_PAGINATE_CONFIG: PaginateConfig<ApiKeyProps> = {
    sortableColumns: ['id', 'name', 'status', 'createdAt', 'lastUsedAt', 'expiresAt'],
    defaultSortBy: [['createdAt', 'DESC']],
    filterableColumns: {
        status: [FilterOperator.EQ, FilterOperator.IN],
        name: [FilterOperator.EQ, FilterOperator.CONTAINS]
    },
    defaultLimit: 10,
    maxLimit: 100
};
