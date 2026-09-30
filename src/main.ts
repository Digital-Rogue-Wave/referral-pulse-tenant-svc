import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import compression from 'compression';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import type { AllConfigType } from '@config/config.type';

import { toWireCaseDocument } from '@common/http-contract/openapi-wire-case';
import { requestIdMiddleware } from '@common/http-contract/request-id.middleware';
import { validationExceptionFactory } from '@common/http-contract/validation-exception.factory';

import { WorkerHealthServer } from '@app/health/worker-health.server';
import { AppModule } from './app.module';

/**
 * Application mode
 * - web: HTTP server mode (default)
 * - worker: Background worker mode (cron jobs only, no HTTP server)
 */
type AppMode = 'web' | 'worker';

async function bootstrap(): Promise<void> {
    // Determine app mode from environment variable
    const appMode = (process.env.APP_MODE?.toLowerCase() || 'web') as AppMode;

    // `rawBody` is required for Stripe webhook signature verification: the signature
    // is computed over the exact bytes Stripe sent, so the parsed JSON body cannot
    // reproduce it. Without this, `req.rawBody` is always undefined and both webhook
    // controllers fall back to `req.body`, which fails verification on every real
    // Stripe webhook — silently, and fail-closed, so billing simply never syncs.
    const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
    const configService = app.get(ConfigService<AllConfigType>);

    const nodeEnv = configService.getOrThrow('app.nodeEnv', { infer: true });
    const serviceName = configService.getOrThrow('app.name', { infer: true });

    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();

    if (appMode === 'worker') {
        // Worker mode: no API; a probe-only server answers /health/live and /health/ready.
        await app.init();
        const healthPort = configService.getOrThrow('app.workerHealthPort', { infer: true });
        await app.get(WorkerHealthServer).start(healthPort);

        console.log(`⚙️  ${serviceName} started in WORKER mode`);
        console.log(`📚 Environment: ${nodeEnv}`);
        console.log(`🔄 Background workers active (cron jobs, outbox processing, etc.)`);
    } else {
        // Web mode: Start HTTP server
        const port = configService.getOrThrow('app.port', { infer: true });
        const apiPrefix = configService.getOrThrow('app.apiPrefix', {
            infer: true
        });
        const allowedOrigins = configService.get('app.allowedOrigins', {
            infer: true
        });

        app.use(requestIdMiddleware);
        app.use(helmet());
        app.use(compression());

        app.enableCors({
            origin: allowedOrigins || '*',
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            // The tenant always comes from the token, so there is no tenant header to allow.
            allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'X-Correlation-Id'],
            exposedHeaders: ['X-Request-Id', 'Retry-After', 'Idempotent-Replayed'],
            credentials: true
        });

        app.setGlobalPrefix(apiPrefix, {
            exclude: ['/health', '/health/ready', '/health/live', '/metrics', '/.well-known/jwks.json', '/internal/validate-token']
        });
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
                transformOptions: { enableImplicitConversion: true },
                exceptionFactory: validationExceptionFactory
            })
        );

        if (nodeEnv !== 'production') {
            const swaggerConfig = new DocumentBuilder()
                .setTitle('Tenant Service API')
                .setDescription('ReferralAI tenant, identity and billing service (API Contract v1.3)')
                .setVersion('1.0')
                .addBearerAuth()
                .build();
            const document = toWireCaseDocument(SwaggerModule.createDocument(app, swaggerConfig));
            SwaggerModule.setup('docs', app, document);
        }

        await app.listen(port);

        console.log(`🚀 ${serviceName} started in WEB mode on port ${port}`);
        console.log(`📚 Environment: ${nodeEnv}`);
        console.log(`📖 API docs: http://localhost:${port}/docs`);
    }
}

void bootstrap();
