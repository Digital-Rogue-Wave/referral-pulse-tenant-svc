import { When } from '@cucumber/cucumber';
import { randomUUID } from 'crypto';

import type { BddWorldInterface } from '../../support/world';

const SETTINGS = '/api/v1/tenant/settings';

When('I change the Owner settings to:', async function (this: BddWorldInterface, body: string) {
    this.response = await this.agent()
        .patch(SETTINGS)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-settings-${randomUUID()}`)
        .set('Content-Type', 'application/json')
        .send(body);
});
