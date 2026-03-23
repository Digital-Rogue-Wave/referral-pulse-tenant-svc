# NestJS Microservice Infrastructure

Infrastructure patterns for NestJS microservices running behind Spring Gateway + AWS ALB.

## Architecture Context

```
Internet → AWS ALB → Spring Gateway → NestJS Microservices (x8)
                          ↓
                    - Routing
                    - Rate Limiting (WAF)
                    - Security Headers
                    - JWT Validation
                    - API Aggregation
```

**What's handled at Gateway/ALB level (NOT here):**
- Rate limiting (AWS WAF / Spring Cloud Gateway)
- Security headers (CSP, HSTS, X-Frame-Options)
- SSL termination
- Public JWT validation
- API documentation aggregation

**What each microservice handles:**
- Health checks for ALB target groups
- Graceful shutdown for zero-downtime deployments
- Context propagation (tenant, correlation, trace headers)
- Compression (optional, can also be at ALB)

## Health Checks (ALB Target Groups)

ALB requires health check endpoints to manage traffic routing. Keep these lightweight.

### Health Controller

```typescript
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import {
    HealthCheck,
    HealthCheckService,
    HealthCheckResult,
    MemoryHealthIndicator
} from '@nestjs/terminus';

import { DatabaseHealthIndicator } from './indicators/database.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

@Controller('health')
@ApiTags('health')
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly memory: MemoryHealthIndicator,
        private readonly database: DatabaseHealthIndicator,
        private readonly redis: RedisHealthIndicator
    ) {}

    /**
     * ALB Health Check - Target Group
     * Path: /health/live
     *
     * ALB calls this every 30s. Must respond < 5s.
     * Returns 200 if app can handle requests.
     */
    @Get('live')
    @HealthCheck()
    @ApiExcludeEndpoint() // Don't expose in Swagger
    async checkLive(): Promise<HealthCheckResult> {
        return this.health.check([
            () => this.memory.checkHeap('memory', 500 * 1024 * 1024) // 500MB
        ]);
    }

    /**
     * Readiness Check - Full dependency check
     * Path: /health/ready
     *
     * Used by deployment scripts to verify service is ready.
     * Checks all critical dependencies.
     */
    @Get('ready')
    @HealthCheck()
    @ApiOperation({ summary: 'Readiness check with all dependencies' })
    async checkReady(): Promise<HealthCheckResult> {
        return this.health.check([
            () => this.database.isHealthy('database'),
            () => this.redis.isHealthy('redis')
        ]);
    }

    /**
     * Detailed health - For monitoring dashboards
     * Path: /health
     */
    @Get()
    @HealthCheck()
    @ApiOperation({ summary: 'Full health check with metrics' })
    async checkAll(): Promise<HealthCheckResult> {
        return this.health.check([
            () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
            () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
            () => this.database.isHealthy('database'),
            () => this.redis.isHealthy('redis')
        ]);
    }
}
```

### Health Indicators

```typescript
// src/health/indicators/database.health-indicator.ts
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

import { DatabaseService } from '@app/database/database.service';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
    constructor(private readonly prisma: DatabaseService) {
        super();
    }

    async isHealthy(key: string): Promise<HealthIndicatorResult> {
        try {
            await this.prisma.$queryRaw`SELECT 1`;
            return this.getStatus(key, true);
        } catch (error) {
            throw new HealthCheckError(
                'Database check failed',
                this.getStatus(key, false, { error: error instanceof Error ? error.message : 'Unknown' })
            );
        }
    }
}

// src/health/indicators/redis.health-indicator.ts
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

import { RedisService } from '@common/redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
    constructor(private readonly redis: RedisService) {
        super();
    }

    async isHealthy(key: string): Promise<HealthIndicatorResult> {
        try {
            await this.redis.ping();
            return this.getStatus(key, true);
        } catch (error) {
            throw new HealthCheckError(
                'Redis check failed',
                this.getStatus(key, false, { error: error instanceof Error ? error.message : 'Unknown' })
            );
        }
    }
}
```

### ALB Target Group Configuration

```yaml
# terraform/alb.tf or CloudFormation
HealthCheckPath: /health/live
HealthCheckIntervalSeconds: 30
HealthCheckTimeoutSeconds: 5
HealthyThresholdCount: 2
UnhealthyThresholdCount: 3
```

## Graceful Shutdown

Critical for zero-downtime deployments with ALB. The service must:
1. Stop accepting new connections
2. Complete in-flight requests
3. Close database/Redis connections
4. Exit cleanly

### Main Bootstrap

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { AppLoggerService } from '@common/logging/app-logger.service';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        bufferLogs: true
    });

    const config = app.get(ConfigService);
    const logger = app.get(AppLoggerService);

    app.useLogger(logger);
    app.setGlobalPrefix('api');

    // Enable graceful shutdown
    app.enableShutdownHooks();

    const port = config.get<number>('app.port', 8080);
    await app.listen(port, '0.0.0.0');

    logger.log(`Service started on port ${port}`, 'Bootstrap');
}

bootstrap();
```

### Shutdown Service

```typescript
// src/common/lifecycle/shutdown.service.ts
import { Injectable, OnApplicationShutdown } from '@nestjs/common';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { DatabaseService } from '@app/database/database.service';
import { RedisService } from '@common/redis/redis.service';

@Injectable()
export class ShutdownService implements OnApplicationShutdown {
    constructor(
        private readonly logger: AppLoggerService,
        private readonly prisma: DatabaseService,
        private readonly redis: RedisService
    ) {
        this.logger.setContext(ShutdownService.name);
    }

    async onApplicationShutdown(signal?: string): Promise<void> {
        this.logger.log(`Shutdown signal received: ${signal}`);

        // ALB deregistration delay - wait for ALB to stop sending traffic
        // ALB takes ~30s to deregister, but we wait 5s for safety margin
        this.logger.log('Waiting for ALB deregistration...');
        await this.delay(5000);

        // Close database connections
        this.logger.log('Closing database connections...');
        await this.prisma.$disconnect();

        // Close Redis connections
        this.logger.log('Closing Redis connections...');
        await this.redis.quit();

        this.logger.log('Shutdown complete');
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
```

### ECS/Kubernetes Configuration

```yaml
# ECS Task Definition
stopTimeout: 30  # Give app 30s to shutdown gracefully

# Kubernetes Deployment
spec:
  terminationGracePeriodSeconds: 30
  containers:
    - lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 5"]  # Wait for service mesh
```

## Internal Service Communication

`HttpOutboundInterceptor` automatically handles header propagation for all outbound HTTP requests via Axios interceptors.

### Header Forwarding Logic

```typescript
// src/common/interceptor/http-outbound.interceptor.ts

// Always forwarded (all services):
headers['x-tenant-id'] = tenantContext.getTenantId();
headers['x-user-id'] = tenantContext.getUserId();
// + tracing headers via HttpMetricsService.injectTracingHeaders()

// Internal services only (JWT forwarding):
if (isInternalService(url)) {
    const authHeader = tenantContext.getMetadata<string>('authHeader');
    if (authHeader) {
        headers['Authorization'] = authHeader;
    }
}

// External services (security):
if (!isInternalService(url)) {
    delete headers['Authorization'];
    delete headers['Cookie'];
}
```

### Configuration

Internal services are identified by domain patterns in config:

```typescript
// src/config/http.config.ts
http: {
    internalServiceDomains: [
        '*.svc.cluster.local',      // Kubernetes services
        '*.internal.example.com',   // Internal domain
        'localhost'                 // Local development
    ]
}
```

### Usage

```typescript
@Injectable()
export class MyService {
    constructor(private readonly httpClient: HttpClientService) {}

    async callInternalService(): Promise<SomeResponse> {
        // JWT + tenant context automatically forwarded
        const response = await this.httpClient.get<SomeResponse>(
            'http://campaign-service.default.svc.cluster.local/api/campaigns'
        );
        return response.data;
    }

    async callExternalApi(): Promise<ExternalResponse> {
        // JWT stripped, only tenant context forwarded
        const response = await this.httpClient.get<ExternalResponse>(
            'https://api.external-provider.com/data'
        );
        return response.data;
    }
}
```

## Compression

Optional at service level if not handled by ALB/Gateway.

```typescript
// src/main.ts
import compression from 'compression';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Only if not using ALB compression
    app.use(compression({
        threshold: 1024,  // Only compress > 1KB
        level: 6          // Balanced compression
    }));

    await app.listen(8080);
}
```

## Swagger (Development Only)

For internal development/debugging. Not exposed through gateway.

```typescript
// src/main.ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const config = app.get(ConfigService);

    // Only enable in development
    if (config.get<string>('NODE_ENV') === 'development') {
        const swaggerConfig = new DocumentBuilder()
            .setTitle('Campaign Service')
            .setDescription('Internal API documentation')
            .setVersion('1.0')
            .addBearerAuth()
            .build();

        const document = SwaggerModule.createDocument(app, swaggerConfig);
        SwaggerModule.setup('api/docs', app, document);
    }

    await app.listen(8080);
}
```

## Environment Variables

```bash
# Service identity
SERVICE_NAME=campaign-service
NODE_ENV=production

# Server
PORT=8080

# Database (RDS)
DATABASE_URL=postgresql://user:pass@rds-endpoint:5432/campaign

# Redis (ElastiCache)
REDIS_URL=redis://elasticache-endpoint:6379

# Internal service URLs (via service discovery or environment)
USER_SERVICE_URL=http://user-service.internal:8080
REWARD_SERVICE_URL=http://reward-service.internal:8080

# AWS (uses IAM roles in production, explicit keys in dev)
AWS_REGION=eu-central-1
# AWS_ACCESS_KEY_ID=xxx  # Only in development
# AWS_SECRET_ACCESS_KEY=xxx  # Only in development
```

## Summary

| Concern | Handled By |
|---------|-----------|
| Rate Limiting | AWS WAF / Spring Gateway |
| Security Headers | Spring Gateway |
| SSL Termination | AWS ALB |
| Public Auth (JWT) | Spring Gateway |
| Health Checks | Each microservice (`/health/live`) |
| Graceful Shutdown | Each microservice |
| Internal Service Headers | `HttpOutboundInterceptor` (JWT + tenant context) |
| External Service Headers | `HttpOutboundInterceptor` (tenant context only, JWT stripped) |
| Compression | ALB or microservice |
| Swagger | Dev only, not exposed |