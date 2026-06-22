/**
 * Invitation Step Definitions
 *
 * Provides the invitee's Ory token (email-bearing, tenantless) used by the accept flow.
 */

import { Given } from '@cucumber/cucumber';
import { makeInviteeToken } from '../support/jwt.helper';
import type { BddWorldInterface } from '../support/world';

Given('I have an invitee token for email {string}', function (this: BddWorldInterface, email: string) {
    this.currentToken = makeInviteeToken(email);
});
