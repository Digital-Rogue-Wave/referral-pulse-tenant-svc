import { Global, Module } from '@nestjs/common';

import { DateService } from '@common/helper';

import { TenantContextService } from './tenant-context.service';
import { TenantAwareService } from './tenant-aware.service';

/**
 * Global module for tenant-aware services.
 *
 * Provides:
 * - TenantContextService: Access to AsyncLocalStorage request context
 * - TenantAwareService: Tenant-scoped operations and validation
 *
 * Note: ALS context is initialized by AlsAuthInterceptor (in InterceptorModule),
 * which runs for all requests and populates context from headers and JWT claims.
 */
@Global()
@Module({
    providers: [DateService, TenantContextService, TenantAwareService],
    exports: [TenantContextService, TenantAwareService]
})
export class TenantAwareModule {}
