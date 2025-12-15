import { FilterOperator, FilterSuffix, PaginateConfig } from 'nestjs-paginate';
import { TeamMemberEntity } from '../team-member.entity';

export const tenantMemberPaginationConfig: PaginateConfig<TeamMemberEntity> = {
    defaultSortBy: [['createdAt', 'DESC']],
    relations: ['tenant'],
    searchableColumns: ['role', 'tenant.id'],
    sortableColumns: ['createdAt', 'updatedAt', 'role'],
    maxLimit: 100,
    loadEagerRelations: true,
    filterableColumns: {
        role: [FilterOperator.EQ, FilterSuffix.NOT]
    }
};
