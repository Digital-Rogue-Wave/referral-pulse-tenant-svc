import { Module, Controller, Get, Param, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TerminusModule, HealthCheckService, HealthCheck, PrismaHealthIndicator, MemoryHealthIndicator } from '@nestjs/terminus';

import type { CircuitBreakerInfo } from '@app/types';

import { Public } from '@common/auth/public.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation } from '@common/auth/keto.constants';
import { HttpClientService } from '@common/http/http-client.service';
import { HttpModule } from '@common/http/http.module';
import { RedisHealthIndicator } from '@common/redis/redis-health.indicator';
import { DatabaseService } from '@app/database/database.service';

/**
 * The database probe used `TypeOrmHealthIndicator`, a leftover from before the
 * platform moved to Prisma. `@nestjs/terminus` ships indicators for several ORMs,
 * so it imported cleanly with no TypeORM installed — and then could never resolve
 * a DataSource, which made `/health/ready` and `/health` 503 permanently.
 *
 * `@Public()` covers only the three probe endpoints. It used to sit at class level,
 * which also exposed the circuit-breaker routes — internal service topology on the
 * reads, and unauthenticated state mutation on the reset.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly db: PrismaHealthIndicator,
        private readonly prisma: DatabaseService,
        private readonly memory: MemoryHealthIndicator,
        private readonly redis: RedisHealthIndicator,
        private readonly httpClient: HttpClientService
    ) {}

    @Public()
    @Get('live')
    @ApiOperation({ summary: 'Liveness probe' })
    @HealthCheck()
    liveness() {
        return this.health.check([() => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024)]);
    }

    @Public()
    @Get('ready')
    @ApiOperation({ summary: 'Readiness probe' })
    @HealthCheck()
    readiness() {
        return this.health.check([() => this.db.pingCheck('database', this.prisma), () => this.redis.isHealthy('redis')]);
    }

    @Public()
    @Get()
    @ApiOperation({ summary: 'Full health check' })
    @HealthCheck()
    check() {
        return this.health.check([
            () => this.db.pingCheck('database', this.prisma),
            () => this.redis.isHealthy('redis'),
            () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
            () => this.memory.checkRSS('memory_rss', 500 * 1024 * 1024)
        ]);
    }

    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ })
    @Get('circuit-breakers')
    @ApiOperation({ summary: 'Get all circuit breaker states' })
    getCircuitBreakers(): CircuitBreakerInfo[] {
        return this.httpClient.getAllCircuitBreakerStates();
    }

    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ })
    @Get('circuit-breakers/:serviceName')
    @ApiOperation({ summary: 'Get circuit breaker state for a specific service' })
    getCircuitBreaker(@Param('serviceName') serviceName: string): CircuitBreakerInfo | { error: string } {
        const state = this.httpClient.getCircuitBreakerState(serviceName);
        return state ?? { error: 'Circuit breaker not found for service' };
    }

    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.UPDATE })
    @Post('circuit-breakers/:serviceName/reset')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Manually reset a circuit breaker' })
    @ApiResponse({
        status: 204,
        description: 'Circuit breaker reset successfully'
    })
    resetCircuitBreaker(@Param('serviceName') serviceName: string): void {
        this.httpClient.resetCircuitBreaker(serviceName);
    }
}

@Module({
    imports: [TerminusModule, HttpModule],
    controllers: [HealthController]
})
export class HealthModule {}
