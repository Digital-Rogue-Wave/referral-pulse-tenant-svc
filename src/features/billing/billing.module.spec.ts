/**
 * `TestBillingController` exposes ~24 dev-only routes (usage mutation, subscription cancel/upgrade/
 * downgrade, plan seeding, direct triggers for the scheduled billing jobs). It used to be registered
 * everywhere except NODE_ENV=production, which left it live on staging and on any mis-set environment.
 * It is now registered only when ENABLE_TEST_ROUTES=true is set explicitly.
 *
 * The module's metadata is evaluated at import time, so each case re-imports the module with the
 * environment already set.
 */
describe('BillingModule controller registration', () => {
    const ORIGINAL = { nodeEnv: process.env.NODE_ENV, testRoutes: process.env.ENABLE_TEST_ROUTES };

    const controllersFor = (env: { nodeEnv: string; testRoutes?: string }): string[] => {
        jest.resetModules();
        process.env.NODE_ENV = env.nodeEnv;
        if (env.testRoutes === undefined) {
            delete process.env.ENABLE_TEST_ROUTES;
        } else {
            process.env.ENABLE_TEST_ROUTES = env.testRoutes;
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { BillingModule } = require('./billing.module');
        return (Reflect.getMetadata('controllers', BillingModule) as Array<{ name: string }>).map((c) => c.name);
    };

    afterEach(() => {
        process.env.NODE_ENV = ORIGINAL.nodeEnv;
        if (ORIGINAL.testRoutes === undefined) {
            delete process.env.ENABLE_TEST_ROUTES;
        } else {
            process.env.ENABLE_TEST_ROUTES = ORIGINAL.testRoutes;
        }
        jest.resetModules();
    });

    it.each(['production', 'staging', 'development', 'test'])(
        'does not register TestBillingController in %s unless explicitly enabled',
        (nodeEnv) => {
            expect(controllersFor({ nodeEnv })).not.toContain('TestBillingController');
            expect(controllersFor({ nodeEnv, testRoutes: 'false' })).not.toContain('TestBillingController');
        }
    );

    it('registers TestBillingController only when ENABLE_TEST_ROUTES=true', () => {
        expect(controllersFor({ nodeEnv: 'development', testRoutes: 'true' })).toContain('TestBillingController');
    });

    it('keeps every real controller registered', () => {
        expect(controllersFor({ nodeEnv: 'production' })).toEqual(
            expect.arrayContaining([
                'BillingController',
                'PlanAdminController',
                'PlanPublicController',
                'UsageInternalController',
                'InternalTenantStatusController',
                'StripeRedirectController'
            ])
        );
    });
});
