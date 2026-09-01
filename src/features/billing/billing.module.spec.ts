/**
 * `TestBillingController` shipped to production because it was listed
 * unconditionally in BillingModule's `controllers`. It exposes ~24 routes behind
 * bare JWT with no permission checks — usage mutation, subscription
 * cancel/upgrade/downgrade, plan seeding, and direct triggers for the scheduled
 * billing jobs. It must never be registered in a production build.
 *
 * The module's metadata is evaluated at import time, so each case re-imports the
 * module with NODE_ENV already set.
 */
describe('BillingModule controller registration', () => {
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

    const controllersFor = (nodeEnv: string): Array<{ name: string }> => {
        jest.resetModules();
        process.env.NODE_ENV = nodeEnv;

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { BillingModule } = require('./billing.module');

        return Reflect.getMetadata('controllers', BillingModule) as Array<{ name: string }>;
    };

    afterEach(() => {
        process.env.NODE_ENV = ORIGINAL_NODE_ENV;
        jest.resetModules();
    });

    it('does not register TestBillingController in production', () => {
        const names = controllersFor('production').map((c) => c.name);

        expect(names).not.toContain('TestBillingController');
    });

    it.each(['development', 'test', 'staging'])('registers TestBillingController in %s', (nodeEnv) => {
        const names = controllersFor(nodeEnv).map((c) => c.name);

        expect(names).toContain('TestBillingController');
    });

    it('keeps every real controller registered in production', () => {
        const names = controllersFor('production').map((c) => c.name);

        expect(names).toEqual(
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
