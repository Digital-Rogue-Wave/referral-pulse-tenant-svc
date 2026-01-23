/**
 * Central Interceptor Export
 *
 * Re-exports all interceptors from their respective modules.
 * Provides a single import point for all application interceptors.
 */

// Module
export { InterceptorModule } from './interceptor.module';

// Auth Interceptors
export { ClsAuthInterceptor } from '@app/common/auth/cls-auth.interceptor';

// HTTP Interceptors
export { HttpOutboundInterceptor } from '@app/common/http/http-outbound.interceptor';

/**
 * Usage Examples:
 *
 * // Import all interceptors from one place
 * import {
 *   ClsAuthInterceptor,
 *   HttpOutboundInterceptor,
 * } from '@app/common/interceptor';
 *
 * // Or import the module
 * import { InterceptorModule } from '@app/common/interceptor';
 */