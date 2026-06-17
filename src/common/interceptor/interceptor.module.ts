import { Module } from '@nestjs/common';

import { AlsAuthInterceptor } from '@app/common/interceptor/als-auth.interceptor';
import { HttpOutboundInterceptor } from '@app/common/interceptor/http-outbound.interceptor';
import { IdempotencyInterceptor } from '@app/common/interceptor/idempotency.interceptor';

/**
 * Centralized Interceptor Module
 *
 * Provides a single import point for all interceptors across the application.
 * This module re-exports interceptors for convenience and clear documentation.
 *
 * Available Interceptors:
 * - AlsAuthInterceptor: Populates ALS context from authenticated user (tenant, user, trace IDs)
 * - HttpOutboundInterceptor: Handles outbound HTTP calls (metrics, JWT forwarding, tracing)
 * - IdempotencyInterceptor: Enforces idempotency for HTTP endpoints with @Idempotent() decorator
 *
 * Usage:
 * These interceptors are typically registered globally in AppModule or used via decorators.
 *
 * @example Global registration (AppModule):
 * ```typescript
 * providers: [
 *   { provide: APP_INTERCEPTOR, useClass: AlsAuthInterceptor },
 *   { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
 * ]
 * ```
 *
 * @example Per-route usage:
 * ```typescript
 * @UseInterceptors(IdempotencyInterceptor)
 * @Post()
 * create() { ... }
 * ```
 */
@Module({
    providers: [AlsAuthInterceptor, HttpOutboundInterceptor, IdempotencyInterceptor],
    exports: [AlsAuthInterceptor, HttpOutboundInterceptor, IdempotencyInterceptor]
})
export class InterceptorModule {}
