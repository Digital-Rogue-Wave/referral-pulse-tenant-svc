import { InvitationChannel, defaultInvitationChannel, effectiveInvitationChannel } from './tenant.types';

/**
 * R-PRT-02 — the tenant level of the invitation setting carries the *jurisdiction*. Platform-sent
 * tell-a-friend email is unsolicited advertising attributable to the company under German
 * competition law (BGH 2013, Empfehlungs-E-Mail) and lawful elsewhere under legitimate interest, so
 * the platform default is `forbidden` for German tenants and `allowed` for everyone else.
 */
describe('Invitation channel (R-PRT-02)', () => {
    describe('given the Owner has made no choice', () => {
        it.each(['DE', 'de'])('then a German tenant (%s) defaults to forbidden, whatever the casing', (country) => {
            expect(defaultInvitationChannel(country)).toBe(InvitationChannel.FORBIDDEN);
            expect(effectiveInvitationChannel({ billingCountry: country, invitationChannel: null })).toBe(InvitationChannel.FORBIDDEN);
        });

        it.each(['FR', 'ES', 'NL'])('then a tenant in %s defaults to allowed', (country) => {
            expect(effectiveInvitationChannel({ billingCountry: country, invitationChannel: null })).toBe(InvitationChannel.ALLOWED);
        });

        /**
         * The country is not known at provisioning. Defaulting to `forbidden` for everyone would
         * switch the feature off for the whole platform until each tenant is corrected; the rule
         * names Germany, not "unknown".
         */
        it('then an unknown billing country defaults to allowed', () => {
            expect(effectiveInvitationChannel({ billingCountry: null, invitationChannel: null })).toBe(InvitationChannel.ALLOWED);
            expect(effectiveInvitationChannel({})).toBe(InvitationChannel.ALLOWED);
        });
    });

    describe('given the Owner chose explicitly', () => {
        it('then the choice wins over the jurisdiction default, in both directions', () => {
            expect(effectiveInvitationChannel({ billingCountry: 'DE', invitationChannel: InvitationChannel.ALLOWED })).toBe(
                InvitationChannel.ALLOWED
            );
            expect(effectiveInvitationChannel({ billingCountry: 'FR', invitationChannel: InvitationChannel.FORBIDDEN })).toBe(
                InvitationChannel.FORBIDDEN
            );
        });

        /** A stored value outside the enum is not a choice; the default is the safe reading. */
        it('then a value that is not one of the two falls back to the default', () => {
            expect(effectiveInvitationChannel({ billingCountry: 'DE', invitationChannel: 'maybe' })).toBe(InvitationChannel.FORBIDDEN);
            expect(effectiveInvitationChannel({ billingCountry: 'FR', invitationChannel: '' })).toBe(InvitationChannel.ALLOWED);
        });
    });
});
