import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import { initializeTransactionalContext } from 'typeorm-transactional';

import { AppModule } from './app.module';
import type { AllConfigType } from '@app/config/config.type';

/**
 * Application mode
 * - web: HTTP server mode (default)
 * - worker: Background worker mode (cron jobs only, no HTTP server)
 */
type AppMode = 'web' | 'worker';

async function bootstrap(): Promise<void> {
    initializeTransactionalContext();

    // Determine app mode from environment variable
    const appMode = (process.env.APP_MODE?.toLowerCase() || 'web') as AppMode;

    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    const configService = app.get(ConfigService<AllConfigType>);

    const nodeEnv = configService.getOrThrow('app.nodeEnv', { infer: true });
    const serviceName = configService.getOrThrow('app.name', { infer: true });

    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();

    if (appMode === 'worker') {
        // Worker mode: No HTTP server, just keep app running for cron jobs
        await app.init();

        console.log(`⚙️  ${serviceName} started in WORKER mode`);
        console.log(`📚 Environment: ${nodeEnv}`);
        console.log(`🔄 Background workers active (cron jobs, outbox processing, etc.)`);
    } else {
        // Web mode: Start HTTP server
        const port = configService.getOrThrow('app.port', { infer: true });
        const apiPrefix = configService.getOrThrow('app.apiPrefix', { infer: true });
        const allowedOrigins = configService.get('app.allowedOrigins', { infer: true });

        app.use(helmet());
        app.use(compression());

        app.enableCors({
            origin: allowedOrigins || '*',
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-correlation-id', 'x-request-id', 'x-idempotency-key'],
            credentials: true,
        });

        app.setGlobalPrefix(apiPrefix, { exclude: ['/health', '/health/ready', '/health/live', '/metrics'] });
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );

        if (nodeEnv !== 'production') {
            const swaggerConfig = new DocumentBuilder()
                .setTitle('Campaign Service API')
                .setDescription('ReferralAI Campaign Management Microservice')
                .setVersion('1.0')
                .addBearerAuth()
                .addApiKey({ type: 'apiKey', name: 'x-tenant-id', in: 'header' }, 'tenant-id')
                .build();
            const document = SwaggerModule.createDocument(app, swaggerConfig);
            SwaggerModule.setup('docs', app, document);
        }

        await app.listen(port);

        console.log(`🚀 ${serviceName} started in WEB mode on port ${port}`);
        console.log(`📚 Environment: ${nodeEnv}`);
        console.log(`📖 API docs: http://localhost:${port}/docs`);
    }
}

bootstrap();
