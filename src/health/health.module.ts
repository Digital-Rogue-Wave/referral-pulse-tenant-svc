import { Module, Controller, Get, Param, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { TerminusModule, HealthCheckService, HealthCheck, TypeOrmHealthIndicator, MemoryHealthIndicator } from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '@app/common/auth/public.decorator';
import { RedisHealthIndicator } from '@app/common/redis/redis.module';
import { HttpClientService } from '@app/common/http/http-client.service';
import { HttpModule } from '@app/common/http/http.module';
import type { ICircuitBreakerState } from '@app/types';

@ApiTags('Health')
@Controller('health')
@Public()
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly db: TypeOrmHealthIndicator,
        private readonly memory: MemoryHealthIndicator,
        private readonly redis: RedisHealthIndicator,
        private readonly httpClient: HttpClientService,
    ) {}

    @Get('live')
    @ApiOperation({ summary: 'Liveness probe' })
    @HealthCheck()
    liveness() {
        return this.health.check([() => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024)]);
    }

    @Get('ready')
    @ApiOperation({ summary: 'Readiness probe' })
    @HealthCheck()
    readiness() {
        return this.health.check([
            () => this.db.pingCheck('database'),
            () => this.redis.isHealthy('redis'),
        ]);
    }

    @Get()
    @ApiOperation({ summary: 'Full health check' })
    @HealthCheck()
    check() {
        return this.health.check([
            () => this.db.pingCheck('database'),
            () => this.redis.isHealthy('redis'),
            () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
            () => this.memory.checkRSS('memory_rss', 500 * 1024 * 1024),
        ]);
    }

    @Get('circuit-breakers')
    @ApiOperation({ summary: 'Get all circuit breaker states' })
    getCircuitBreakers(): ICircuitBreakerState[] {
        return this.httpClient.getAllCircuitBreakerStates();
    }

    @Get('circuit-breakers/:serviceName')
    @ApiOperation({ summary: 'Get circuit breaker state for a specific service' })
    getCircuitBreaker(@Param('serviceName') serviceName: string): ICircuitBreakerState | { error: string } {
        const state = this.httpClient.getCircuitBreakerState(serviceName);
        return state ?? { error: 'Circuit breaker not found for service' };
    }

    @Post('circuit-breakers/:serviceName/reset')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Manually reset a circuit breaker' })
    @ApiResponse({ status: 204, description: 'Circuit breaker reset successfully' })
    resetCircuitBreaker(@Param('serviceName') serviceName: string): void {
        this.httpClient.resetCircuitBreaker(serviceName);
    }
}

@Module({
    imports: [TerminusModule, HttpModule],
    controllers: [HealthController],
})
export class HealthModule {}
