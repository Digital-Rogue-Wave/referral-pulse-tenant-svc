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
// Cache the JWKS signing key: jwks-rsa rate-limits at 10 fetches/min, and with cache
// off every token re-fetched the key, tripping "Too many requests to the JWKS endpoint"
// across a suite run. Caching the key does not weaken validation — signature/exp/aud are
// still checked per token against the (stable) test key.
process.env['AUTH_CACHE_ENABLED'] = 'true';
process.env['AUTH_AUDIENCE'] = 'test-audience';

import { AppModule } from '../../../src/app.module';
import { StripeService } from '../../../src/features/billing/stripe.service';
import { fakeStripeService } from './stripe.fake';

let app: INestApplication | null = null;

export async function bootstrapTestApp(): Promise<INestApplication> {
    if (app) return app;

    const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule]
    })
        // Stripe is an external dependency reached over the network — override with a fake.
        .overrideProvider(StripeService)
        .useValue(fakeStripeService)
        .compile();

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
