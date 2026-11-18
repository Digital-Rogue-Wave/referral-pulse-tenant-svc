import { InvitationChannel, defaultInvitationChannel, effectiveInvitationChannel, invitationChannelSource } from './tenant.types';

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

        /** v5.1 R-PRT-02 adds the Netherlands and the Nordics to Germany. */
        it.each(['NL', 'DK', 'SE', 'FI', 'NO', 'IS'])('then a tenant in %s defaults to forbidden', (country) => {
            expect(effectiveInvitationChannel({ billingCountry: country, invitationChannel: null })).toBe(InvitationChannel.FORBIDDEN);
        });

        it.each(['FR', 'ES', 'IT', 'BE', 'AT', 'IE', 'PT', 'LU'])(
            'then a tenant in %s, a country legal has analysed, defaults to allowed',
            (country) => {
                expect(effectiveInvitationChannel({ billingCountry: country, invitationChannel: null })).toBe(InvitationChannel.ALLOWED);
            }
        );

        /** E1 decision D9: a country nobody has analysed, or none at all, resolves to the lawful side. */
        it.each(['PL', 'US', null, undefined])('then a country not analysed (%s) defaults to forbidden', (country) => {
            expect(effectiveInvitationChannel({ billingCountry: country, invitationChannel: null })).toBe(InvitationChannel.FORBIDDEN);
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

        it('then the source reads explicit for a choice and default otherwise', () => {
            expect(invitationChannelSource({ invitationChannel: InvitationChannel.FORBIDDEN })).toBe('explicit');
            expect(invitationChannelSource({ invitationChannel: null })).toBe('default');
            expect(invitationChannelSource({ invitationChannel: 'maybe' })).toBe('default');
        });
    });
});
