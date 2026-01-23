import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ClsAuthInterceptor } from './cls-auth.interceptor';

/**
 * Authentication module for JWT/OpenID Connect validation.
 * Provides JWT strategy with JWKS validation and CLS population.
 */
@Global()
@Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    providers: [JwtStrategy, JwtAuthGuard, ClsAuthInterceptor],
    exports: [JwtAuthGuard, ClsAuthInterceptor, PassportModule],
})
export class AuthModule {}
