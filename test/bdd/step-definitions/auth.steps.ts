/**
 * Auth Step Definitions
 *
 * Sets up the JWT token in world.currentToken using the jwt.helper factories.
 * The token is later read by the When steps in common.steps.ts.
 */

import { Given } from '@cucumber/cucumber';
import { makeActiveUserToken, makeExpiredToken, makeServiceToken } from '../support/jwt.helper';
import type { BddWorldInterface } from '../support/world';

Given(
    'I have a valid JWT for tenant {string}',
    function (this: BddWorldInterface, tenantId: string) {
        this.currentToken = makeActiveUserToken(tenantId);
    },
);

Given(
    'I have an expired JWT for tenant {string}',
    function (this: BddWorldInterface, tenantId: string) {
        this.currentToken = makeExpiredToken(tenantId);
    },
);

Given(
    'I have a malformed token {string}',
    function (this: BddWorldInterface, rawToken: string) {
        // Store as-is — the When step will send it as a Bearer token
        this.currentToken = rawToken;
    },
);

Given(
    'I have a service token for tenant {string}',
    function (this: BddWorldInterface, tenantId: string) {
        this.currentToken = makeServiceToken(tenantId);
    },
);
