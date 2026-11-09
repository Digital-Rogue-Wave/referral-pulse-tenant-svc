import { invitationResponseMapper, publicInvitationResponseMapper, type InvitationProps } from '@domains/invitation';
import { tenantResponseMapper, type TenantProps } from '@domains/tenant';

/** US1.1.1 C15 (US1.5.4 F1, US1.2.3 F1): secrets and token hashes never leave the service in a response. */
describe('response mappers — explicit field lists', () => {
    const now = new Date('2026-11-09T00:00:00Z');

    it('a tenant answer never carries the widget token secret, and keeps the Owner settings', () => {
        const row = {
            id: 't1',
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            verificationStatus: 'pending',
            paymentStatus: 'active',
            billingCountry: 'DE',
            invitationChannel: null,
            dataRegion: 'eu-central-1',
            retentionMonths: 24,
            createdAt: now,
            updatedAt: now,
            widgetTokenSecret: 'f'.repeat(64)
        } as TenantProps;

        const response = tenantResponseMapper.toResponse(row);

        expect(response).not.toHaveProperty('widgetTokenSecret');
        expect(response).toMatchObject({ id: 't1', slug: 'acme', billingCountry: 'DE', invitationChannel: null, retentionMonths: 24 });
    });

    it('an invitation answer never carries the token hash, and the public lookup hides the tenant id too', () => {
        const row: InvitationProps = {
            id: 'i1',
            tenantId: 't1',
            email: 'owner@acme.com',
            role: 'OWNER',
            status: 'PENDING',
            tokenHash: 'a'.repeat(64),
            expiresAt: now,
            createdAt: now,
            updatedAt: now
        };

        expect(invitationResponseMapper.toResponse(row)).toEqual({
            id: 'i1',
            tenantId: 't1',
            email: 'owner@acme.com',
            role: 'OWNER',
            status: 'PENDING',
            expiresAt: now,
            createdAt: now
        });
        expect(publicInvitationResponseMapper.toResponse(row)).toEqual({ email: 'owner@acme.com', role: 'OWNER', status: 'PENDING', expiresAt: now });
    });
});
