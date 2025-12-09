import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RedisHealthIndicator } from '@mod/health/redis.health';
import { Public } from '@mod/common/auth/jwt-auth.guard';

@Controller({ path: 'health', version: '1' })
@Public()
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly configService: ConfigService,
        private readonly db: TypeOrmHealthIndicator,
        private readonly dataSource: DataSource,
        private readonly redis: RedisHealthIndicator
    ) {}

    @Get('live')
    live() {
        return { status: 'ok' };
    }

    @Get('startup')
    startup() {
        return { status: 'ok' };
    }

    @Get('/ready')
    @HealthCheck()
    async ready() {
        const checks: Array<() => any> = [];

        // DB
        checks.push(async () => this.db.pingCheck('database', { connection: this.dataSource, timeout: 1500 }));

        if (this.configService.get<boolean>('READINESS_CHECK_REDIS', false, { infer: true })) {
            checks.push(async () => this.redis.check());
        }

        return this.health.check(checks);
    }
}
