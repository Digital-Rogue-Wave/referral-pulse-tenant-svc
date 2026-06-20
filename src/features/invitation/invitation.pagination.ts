import type { InvitationProps } from '@domains/invitation';
import { PaginateConfig, FilterOperator } from '@common/nestjs-prisma-pagination';

/**
 * Pagination configuration for the invitation list endpoint.
 */
export const INVITATION_PAGINATE_CONFIG: PaginateConfig<InvitationProps> = {
    sortableColumns: ['id', 'email', 'status', 'createdAt', 'expiresAt'],
    defaultSortBy: [['createdAt', 'DESC']],
    filterableColumns: {
        status: [FilterOperator.EQ, FilterOperator.IN],
        email: [FilterOperator.EQ, FilterOperator.CONTAINS]
    },
    defaultLimit: 10,
    maxLimit: 100
};
