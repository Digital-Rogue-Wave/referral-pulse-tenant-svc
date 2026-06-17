/**
 * NestJS Test Application Bootstrap
 *
 * Creates a real NestJS application instance for BDD tests.
 * External HTTP dependencies are intercepted by nock BEFORE this is called:
 *   - JWKS endpoint  → test RSA public key (real JWT validation)
 *   - Keto           → { allowed: true }
 *
 * The full guard/interceptor stack runs as-is — no guard mocking.
 */

import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

// Set env overrides BEFORE AppModule is imported so ConfigModule picks them up
process.env['NODE_ENV'] = 'test';
process.env['AUTH_CACHE_ENABLED'] = 'false'; // CRITICAL: force JWKS re-fetch per token
process.env['AUTH_AUDIENCE'] = 'test-audience';

import { AppModule } from '../../../src/app.module';

let app: INestApplication | null = null;

export async function bootstrapTestApp(): Promise<INestApplication> {
    if (app) return app;

    const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });

    const apiPrefix = process.env['APP_API_PREFIX'] ?? 'api';

    app.setGlobalPrefix(apiPrefix, {
        exclude: ['/health', '/health/ready', '/health/live', '/metrics']
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true }
        })
    );

    await app.init();
    return app;
}

export async function teardownTestApp(): Promise<void> {
    if (app) {
        await app.close();
        app = null;
    }
}

export function getTestApp(): INestApplication {
    if (!app) throw new Error('Test app not bootstrapped — call bootstrapTestApp() first');
    return app;
}
