import { Module } from '@nestjs/common';

import { AlsAuthInterceptor } from '@app/common/interceptor/als-auth.interceptor';
import { HttpOutboundInterceptor } from '@app/common/interceptor/http-outbound.interceptor';

/**
 * Centralized Interceptor Module
 *
 * Provides a single import point for all interceptors across the application.
 * This module re-exports interceptors for convenience and clear documentation.
 *
 * Available Interceptors:
 * - AlsAuthInterceptor: Populates ALS context from authenticated user (tenant, user, trace IDs)
 * - HttpOutboundInterceptor: Handles outbound HTTP calls (metrics, JWT forwarding, tracing)
 *
 * Usage:
 * These interceptors are typically registered globally in AppModule or used via decorators.
 *
 * @example Global registration (AppModule):
 * ```typescript
 * providers: [
 *   { provide: APP_INTERCEPTOR, useClass: AlsAuthInterceptor },
 * ]
 * ```
 *
 * @example Per-route usage:
 * ```typescript
 * @Post()
 * create() { ... }
 * ```
 */
@Module({
    providers: [AlsAuthInterceptor, HttpOutboundInterceptor],
    exports: [AlsAuthInterceptor, HttpOutboundInterceptor]
})
export class InterceptorModule {}
