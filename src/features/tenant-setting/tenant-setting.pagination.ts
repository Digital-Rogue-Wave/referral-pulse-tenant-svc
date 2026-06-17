import type { TenantSettingProps } from '@domains/tenant-setting';
import { PaginateConfig } from '@common/nestjs-prisma-pagination';

/**
 * Pagination configuration for TenantSetting list endpoint
 */
export const TENANT_SETTING_PAGINATE_CONFIG: PaginateConfig<TenantSettingProps> = {
    sortableColumns: ['id', 'createdAt', 'updatedAt'],
    defaultSortBy: [['createdAt', 'DESC']],
    filterableColumns: {},
    defaultLimit: 10,
    maxLimit: 100
};
