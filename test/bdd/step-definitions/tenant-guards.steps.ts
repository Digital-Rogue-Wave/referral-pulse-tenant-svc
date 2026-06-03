/**
 * Tenant Guard Step Definitions
 *
 * Binds the fixture tenant ID (set by tagged Before hooks) to a JWT token.
 * The fixture tenant was already created in the DB by the hook — this step
 * just creates a token for that tenant so requests are routed to it.
 */

import { Given } from '@cucumber/cucumber';
import assert from 'assert';
import { makeActiveUserToken } from '../support/jwt.helper';
import type { BddWorldInterface } from '../support/world';

Given('I have a valid JWT for the current fixture tenant', function (this: BddWorldInterface) {
    assert.ok(
        this.currentTenantId,
        'No fixture tenant set — add the correct @needs-* tag to the scenario',
    );
    this.currentToken = makeActiveUserToken(this.currentTenantId);
});
