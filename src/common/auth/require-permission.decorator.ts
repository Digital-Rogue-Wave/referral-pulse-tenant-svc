import { SetMetadata, CustomDecorator } from '@nestjs/common';

import type { KetoPermission } from '@app/types';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Require Keto permissions on a route.
 *
 * @example
 * ```typescript
 * @RequirePermission(
 *   { namespace: KetoNamespace.TENANT, relation: KetoRelation.READ },
 *   { namespace: KetoNamespace.TENANT, object: KetoResource.API_KEY, relation: KetoRelation.CREATE, allowServiceTokens: true },
 * )
 * ```
 */
export const RequirePermission = (...permissions: KetoPermission[]): CustomDecorator<string> => SetMetadata(PERMISSIONS_KEY, permissions);
