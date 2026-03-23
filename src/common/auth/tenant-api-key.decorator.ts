import { SetMetadata } from '@nestjs/common';

import { IS_TENANT_API_KEY_PROTECTED_KEY } from './tenant-api-key.guard';

/**
 * Decorator to mark routes as requiring a valid Tenant API Key.
 * Also automatically sets the tenant context.
 */
export const TenantApiKeyProtected = () => SetMetadata(IS_TENANT_API_KEY_PROTECTED_KEY, true);
