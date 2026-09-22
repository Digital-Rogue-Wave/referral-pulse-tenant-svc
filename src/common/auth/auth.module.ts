import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';

import { AuthorizationService } from './authz/authorization.service';
import { KetoProvisioningService } from './authz/keto-provisioning.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { PermissionGuard } from './permission.guard';
import { TenantAccessGuard } from './tenant-access.guard';
import { TenantStateCache } from './tenant-state.cache';
import { KetoService } from './keto.service';
import { KratosService } from './kratos.service';
import { AlsAuthInterceptor } from '../interceptor';

/**
 * Authentication module for JWT/OpenID Connect validation.
 *
 * Guards registered globally via APP_GUARD:
 * - JwtAuthGuard: validates JWT on all routes (skip with @Public())
 * - PermissionGuard: deny-by-default authorization from the JWT `perms` snapshot + live Keto for high-risk actions
 */
@Global()
@Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_GUARD, useClass: TenantAccessGuard },
        TenantStateCache,
        AlsAuthInterceptor,
        AuthorizationService,
        KetoProvisioningService,
        KetoService,
        KratosService
    ],
    exports: [AlsAuthInterceptor, AuthorizationService, KetoProvisioningService, KetoService, KratosService, PassportModule]
})
export class AuthModule {}
