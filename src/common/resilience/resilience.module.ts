import { Global, Module } from '@nestjs/common';

import { CircuitBreakerService } from './circuit-breaker.service';

/**
 * ResilienceModule
 *
 * Provides resilience patterns for the application:
 * - Circuit breaker for external service calls
 * - Automatic failure detection and recovery
 * - LRU-cached circuit breakers per service
 */
@Global()
@Module({
    providers: [CircuitBreakerService],
    exports: [CircuitBreakerService],
})
export class ResilienceModule {}
