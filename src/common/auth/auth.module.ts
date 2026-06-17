import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';

import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { PermissionGuard } from './permission.guard';
import { KetoService } from './keto.service';
import { KratosService } from './kratos.service';
import { AlsAuthInterceptor } from '../interceptor';

/**
 * Authentication module for JWT/OpenID Connect validation.
 *
 * Guards registered globally via APP_GUARD:
 * - JwtAuthGuard: validates JWT on all routes (skip with @Public())
 * - PermissionGuard: checks Keto permissions (skip by omitting @RequirePermission())
 */
@Global()
@Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        AlsAuthInterceptor,
        KetoService,
        KratosService
    ],
    exports: [AlsAuthInterceptor, KetoService, KratosService, PassportModule]
})
export class AuthModule {}
