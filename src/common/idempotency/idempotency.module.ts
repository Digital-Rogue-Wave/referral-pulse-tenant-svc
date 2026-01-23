import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyKeyGenerator } from './idempotency-key.generator';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * Global Idempotency Module
 *
 * Provides idempotency support for HTTP and RPC calls
 * Prevents duplicate processing using Redis-backed storage
 *
 * Features:
 * - Automatic HTTP idempotency via @Idempotent() decorator
 * - SQS message idempotency via MessageProcessorService
 * - Manual idempotency via IdempotencyService
 * - Redis-backed response caching
 * - Tenant/User/Global scoping
 *
 * @example HTTP Usage:
 * ```typescript
 * @Post('orders')
 * @Idempotent({ scope: IdempotencyScope.User, ttl: 3600 })
 * async createOrder(@Body() dto: CreateOrderDto) {
 *   return this.ordersService.create(dto);
 * }
 * ```
 *
 * Client sends:
 * ```bash
 * curl -X POST /api/v1/orders \
 *   -H "Idempotency-Key: user-order-12345" \
 *   -d '{"amount": 100}'
 * ```
 *
 * @example RPC Usage:
 * ```typescript
 * @MessagePattern('order.create')
 * @Idempotent({ scope: IdempotencyScope.Tenant })
 * async handleCreateOrder(@Payload() data: CreateOrderMessage) {
 *   return this.ordersService.create(data);
 * }
 * ```
 *
 * @example Manual Usage:
 * ```typescript
 * const key = this.keyGenerator.generate({
 *   method: 'POST',
 *   path: '/orders',
 *   body: orderData,
 *   userId: user.id,
 * }, IdempotencyScope.User);
 *
 * const { result, isDuplicate } = await this.idempotency.executeOnce(
 *   key,
 *   () => this.processOrder(orderData),
 *   { ttl: 3600 }
 * );
 * ```
 */
@Global()
@Module({
    providers: [
        IdempotencyService,
        IdempotencyKeyGenerator,
        // Register interceptor globally for all HTTP endpoints
        {
            provide: APP_INTERCEPTOR,
            useClass: IdempotencyInterceptor,
        },
    ],
    exports: [IdempotencyService, IdempotencyKeyGenerator],
})
export class IdempotencyModule {}