/**
 * Invitation Step Definitions
 *
 * Provides the invitee's Ory token (email-bearing, tenantless) used by the accept flow.
 */

import { Given } from '@cucumber/cucumber';
import { makeInviteeToken } from '../support/jwt.helper';
import { stubKratosIdentity } from '../support/nock.setup';
import type { BddWorldInterface } from '../support/world';

/**
 * Each email is its own Ory identity: the service reads the address from Kratos, never from the token,
 * so an "intruder" is a different identity whose Kratos email differs from the invitation.
 */
Given('I have an invitee token for email {string}', function (this: BddWorldInterface, email: string) {
    const kratosId = email === 'invitee-bdd@acme.com' ? 'kratos-invitee-bdd' : `kratos-${email.replace(/[^a-z0-9]/gi, '-')}`;
    stubKratosIdentity(kratosId, email);
    this.currentToken = makeInviteeToken(email, kratosId);
});
