import { SetMetadata } from '@nestjs/common';

import { ALLOW_NO_TENANT_KEY } from '@app/types';

/**
 * Marks a route as authenticated but tenant-optional.
 *
 * The token is still fully validated (signature, issuer, audience, expiry) and a human principal is
 * required, but `JwtAuthGuard` will not reject it for lacking a tenant claim. Reserved for onboarding
 * flows where the caller has an Ory identity but no tenant membership yet — e.g. accepting an invitation.
 *
 * @example
 * ```typescript
 * @AllowNoTenant()
 * @Post(':token/accept')
 * accept(@Param('token') token: string, @CurrentUser() user: IAuthenticatedUser) { ... }
 * ```
 */
export const AllowNoTenant = () => SetMetadata(ALLOW_NO_TENANT_KEY, true);
