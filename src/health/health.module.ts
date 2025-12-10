import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HealthController } from './health.controller';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { RedisHealthIndicator } from '@mod/health/redis.health';
import { CommonModule } from '@mod/common/common.module';

@Module({
    imports: [ConfigModule, TerminusModule, TypeOrmModule, CommonModule],
    controllers: [HealthController],
    providers: [TypeOrmHealthIndicator, RedisHealthIndicator]
})
export class HealthModule {}
