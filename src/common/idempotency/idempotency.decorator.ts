import { SetMetadata } from '@nestjs/common';
import type { IdempotencyScope, IIdempotencyOptions } from '@app/types';

export const IDEMPOTENCY_KEY = 'idempotency';

export interface IdempotencyDecoratorOptions extends IIdempotencyOptions {
    /**
     * Scope of idempotency (global, tenant, user, custom)
     */
    scope?: IdempotencyScope;

    /**
     * HTTP header name for custom idempotency key
     * @default 'Idempotency-Key'
     */
    headerName?: string;

    /**
     * Whether idempotency is required (reject if no key provided)
     * @default false
     */
    required?: boolean;
}

/**
 * Decorator to enable idempotency for HTTP endpoints or RPC handlers
 *
 * @example
 * ```typescript
 * @Post('payments')
 * @Idempotent({ scope: IdempotencyScope.User, ttl: 3600 })
 * async createPayment(@Body() data: CreatePaymentDto) {
 *   // This will only execute once per unique request
 *   return this.paymentsService.create(data);
 * }
 * ```
 */
export const Idempotent = (options: IdempotencyDecoratorOptions = {}) =>
    SetMetadata(IDEMPOTENCY_KEY, {
        scope: 'global' as IdempotencyScope,
        headerName: 'Idempotency-Key',
        required: false,
        storeResponse: true,
        ...options,
    });