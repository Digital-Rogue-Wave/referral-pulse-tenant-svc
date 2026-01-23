import { Module } from '@nestjs/common';
import { AuthModule } from '@app/common/auth/auth.module';
import { HttpModule } from '@app/common/http/http.module';
import { MessagingModule } from '@app/common/messaging/messaging.module';

/**
 * Centralized Interceptor Module
 *
 * Provides a single import point for all interceptors across the application.
 * Interceptors remain in their respective feature modules for cohesion,
 * but this module re-exports them for convenience.
 *
 * Available Interceptors:
 * - ClsAuthInterceptor (from AuthModule)
 * - HttpOutboundInterceptor (from HttpModule)
 *
 * Usage:
 * Import InterceptorModule in your feature modules to get access to all interceptors.
 */
@Module({
    imports: [
        AuthModule,
        HttpModule,
        MessagingModule.forRoot(),
    ],
    exports: [
        AuthModule,
        HttpModule,
        MessagingModule,
    ],
})
export class InterceptorModule {}