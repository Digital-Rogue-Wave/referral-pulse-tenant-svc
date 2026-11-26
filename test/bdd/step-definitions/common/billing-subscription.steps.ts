import { Given } from '@cucumber/cucumber';

import { fixturesPrisma } from '../../support/db.fixtures';
import { theCompany } from './billing-plan.steps';

export const subscriptionOf = (tenantId: string): string => `sub_bdd_${tenantId}`;

Given('that company has a live {string} subscription', async function (plan: string) {
    const { tenantId } = theCompany();
    // A signed-up company gets its billing row on first read, so it may not exist yet.
    const live = { plan, status: 'active', stripeSubscriptionId: subscriptionOf(tenantId), stripeCustomerId: `cus_bdd_${tenantId}` };
    await fixturesPrisma.billing.upsert({ where: { tenantId }, create: { tenantId, ...live }, update: live });
});
