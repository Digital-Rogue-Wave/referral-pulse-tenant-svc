import { FilterOperator, FilterSuffix, PaginateConfig } from 'nestjs-paginate';
import { InvitationEntity } from '../invitation.entity';

export const invitationPaginationConfig: PaginateConfig<InvitationEntity> = {
    defaultSortBy: [['createdAt', 'DESC']],
    relations: ['tenant'],
    searchableColumns: ['email', 'role'],
    sortableColumns: ['createdAt', 'updatedAt', 'role'],
    maxLimit: 100,
    loadEagerRelations: true,
    filterableColumns: {
        role: [FilterOperator.EQ, FilterSuffix.NOT]
    }
};
