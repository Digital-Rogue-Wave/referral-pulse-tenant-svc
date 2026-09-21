import { SetMetadata, CustomDecorator } from '@nestjs/common';

import type { ServiceCapability } from './authz/keto-tuples';
import type { Permission } from './authz/permission-catalog';

export const PERMISSIONS_KEY = 'authz:permissions';
export const SERVICE_CAPABILITIES_KEY = 'authz:service_capabilities';
export const PLATFORM_ADMIN_KEY = 'authz:platform_admin';
export const ALLOW_LOCKED_TENANT_KEY = 'authz:allow_locked_tenant';

/**
 * Require tenant-scoped permissions (API §2) on a route, all of them. Coarse permissions are read from
 * the JWT `perms` snapshot; those in LIVE_CHECK_PERMISSIONS are re-checked against Keto.
 *
 * @example `@RequirePermission('api_keys:manage')`
 */
export const RequirePermission = (...permissions: Permission[]): CustomDecorator<string> => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Let client-credentials tokens call the route when Keto grants their client one of these capabilities
 * (`services:{capability}#call@service:{client_id}`). Without it, service tokens are denied.
 */
export const AllowServices = (...capabilities: ServiceCapability[]): CustomDecorator<string> => SetMetadata(SERVICE_CAPABILITIES_KEY, capabilities);

/** Platform-wide operations (cross-tenant): only principals holding `platform:referralai#admin`. */
export const PlatformAdmin = (): CustomDecorator<string> => SetMetadata(PLATFORM_ADMIN_KEY, true);

/** The one tenant route a locked tenant may still call — unlocking itself. */
export const AllowLockedTenant = (): CustomDecorator<string> => SetMetadata(ALLOW_LOCKED_TENANT_KEY, true);
