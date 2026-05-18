import type { TeamMemberProps } from '@domains/team-member';
import { PaginateConfig, FilterOperator } from '@common/nestjs-prisma-pagination';

/**
 * Pagination configuration for Team Member list endpoint
 */
export const TEAM_MEMBER_PAGINATE_CONFIG: PaginateConfig<TeamMemberProps> = {
    sortableColumns: ['id', 'role', 'status', 'createdAt', 'updatedAt'],
    defaultSortBy: [['createdAt', 'DESC']],
    filterableColumns: {
        role: [FilterOperator.EQ, FilterOperator.IN],
        status: [FilterOperator.EQ, FilterOperator.IN],
        userId: [FilterOperator.EQ],
    },
    defaultLimit: 10,
    maxLimit: 100,
};
