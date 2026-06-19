import type { ApiKeyProps } from '@domains/api-key';
import { PaginateConfig, FilterOperator } from '@common/nestjs-prisma-pagination';

/**
 * Pagination configuration for API Key list endpoint
 */
export const API_KEY_PAGINATE_CONFIG: PaginateConfig<ApiKeyProps> = {
    sortableColumns: ['id', 'label', 'createdAt', 'lastUsedAt', 'expiresAt', 'revokedAt'],
    defaultSortBy: [['createdAt', 'DESC']],
    filterableColumns: {
        keyType: [FilterOperator.EQ, FilterOperator.IN],
        label: [FilterOperator.EQ, FilterOperator.CONTAINS]
    },
    defaultLimit: 10,
    maxLimit: 100
};
