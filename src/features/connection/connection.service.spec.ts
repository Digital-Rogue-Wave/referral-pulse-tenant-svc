import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma-gen/generated/client';

import { ConnectionProvider, ConnectionStatus, receiverPath } from '@domains/connection';

import { ConnectionService } from './connection.service';
import { ProviderSecretCipher } from './provider-secret.cipher';

const TENANT_ID = '01HQZX000000000000000TEN';
const CONNECTION_ID = '01HQZX000000000000000CON';
const STRIPE_SECRET = 'whsec_live_abcdefghijklmnop';

const cipher = new ProviderSecretCipher({ get: () => 'a'.repeat(64) } as unknown as ConfigService<never>);

const uniqueViolation = (): Prisma.PrismaClientKnownRequestError =>
    new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.4.0' });

const row = (overrides: Record<string, unknown> = {}) => ({
    id: CONNECTION_ID,
    tenantId: TENANT_ID,
    provider: ConnectionProvider.STRIPE,
    direction: 'inbound',
    status: ConnectionStatus.PENDING_VERIFICATION,
    name: null,
    credentialsEncrypted: null,
    signingSecretEncrypted: cipher.encrypt(STRIPE_SECRET),
    previousSigningSecretEncrypted: null,
    previousSecretValidUntil: null,
    config: {},
    lastVerifiedAt: null,
    lastSyncAt: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T10:00:00Z'),
    revokedAt: null,
    ...overrides
});

const harness = (options: { inboundPublicBaseUrl?: string; testFailure?: string | null } = {}) => {
    const delegate = {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn()
    };
    const scopedFindFirst = jest.fn();
    const emitted: { name: string; event: { payload?: Record<string, unknown>; userId?: string } }[] = [];
    const check = jest.fn().mockResolvedValue(options.testFailure ?? null);
    const redisSet = jest.fn().mockResolvedValue('OK');

    const service = new ConnectionService(
        { providerConnection: delegate, $transaction: (fn: (tx: unknown) => unknown) => fn({ providerConnection: delegate }) } as never,
        {
            getRequiredTenantId: () => TENANT_ID,
            forModel: () => ({ findFirst: scopedFindFirst, findMany: jest.fn().mockResolvedValue([]) })
        } as never,
        { emitAfterCommit: (name: string, event: never) => emitted.push({ name, event }) } as never,
        cipher,
        { check } as never,
        { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as never,
        { getClient: () => ({ set: redisSet }) } as never,
        { get: () => options.inboundPublicBaseUrl } as never
    );
    return { service, delegate, scopedFindFirst, emitted, check, redisSet };
};

const expectBadRequest = async (promise: Promise<unknown>, param: string): Promise<void> => {
    await expect(promise).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST, param });
};

describe('Connections (v5.2 API §3.16)', () => {
    describe('when the Owner creates one', () => {
        it('then a Stripe connection is inbound, pending verification, with its inbound URL and a sealed secret', async () => {
            const { service, delegate, emitted } = harness({ inboundPublicBaseUrl: 'https://api.refrev.io/' });

            const response = await service.create('user-1', { provider: ConnectionProvider.STRIPE, credentials: { signingSecret: STRIPE_SECRET } });

            const data = delegate.create.mock.calls[0][0].data;
            expect(data).toMatchObject({ direction: 'inbound', credentialsEncrypted: null });
            expect(cipher.decrypt(data.signingSecretEncrypted)).toBe(STRIPE_SECRET);
            expect(response).toMatchObject({
                status: 'pending_verification',
                inboundUrl: `https://api.refrev.io${receiverPath('stripe', CONNECTION_ID)}`
            });
            expect(JSON.stringify(response)).not.toContain(STRIPE_SECRET);
            expect(emitted[0]).toMatchObject({
                name: 'connection.created',
                event: { payload: { direction: 'inbound', status: 'pending_verification' } }
            });
        });

        it('then a Zapier connection is outbound, stores nothing and has no inbound URL', async () => {
            const { service, delegate } = harness();

            const response = await service.create('user-1', { provider: ConnectionProvider.ZAPIER });

            expect(delegate.create.mock.calls[0][0].data).toMatchObject({
                direction: 'outbound',
                signingSecretEncrypted: null,
                credentialsEncrypted: null
            });
            expect(JSON.parse(JSON.stringify(response))).not.toHaveProperty('inboundUrl');
        });

        it('then a Chargebee connection keeps its basic-auth pair as the secret its callbacks are checked with', async () => {
            const { service, delegate } = harness();

            await service.create('user-1', {
                provider: ConnectionProvider.CHARGEBEE,
                credentials: { basicAuthUser: 'cb', basicAuthPassword: 'pa55word!' }
            });

            expect(cipher.decrypt(delegate.create.mock.calls[0][0].data.signingSecretEncrypted)).toBe('cb:pa55word!');
        });

        it('then a PayPal connection is both ways: the webhook secret and the outbound credential are sealed apart', async () => {
            const { service, delegate } = harness();

            await service.create('user-1', {
                provider: ConnectionProvider.PAYPAL,
                credentials: { signingSecret: 'paypal-app-secret-0001', apiKey: 'paypal-api-key-0001' }
            });

            const data = delegate.create.mock.calls[0][0].data;
            expect(data.direction).toBe('both');
            expect(JSON.parse(cipher.decrypt(data.credentialsEncrypted))).toEqual({ apiKey: 'paypal-api-key-0001' });
        });

        it.each([
            [
                'a direction other than the matrix',
                { provider: ConnectionProvider.STRIPE, direction: 'outbound', credentials: { signingSecret: STRIPE_SECRET } },
                'direction'
            ],
            ['no signing secret for Stripe', { provider: ConnectionProvider.STRIPE, credentials: {} }, 'credentials.signing_secret'],
            [
                'an api key on an inbound-only provider',
                { provider: ConnectionProvider.PADDLE, credentials: { signingSecret: STRIPE_SECRET, apiKey: 'k-0000000001' } },
                'credentials.api_key'
            ],
            ['no outbound credential for Wise', { provider: ConnectionProvider.WISE, credentials: {} }, 'credentials.api_key'],
            ['credentials on Zapier', { provider: ConnectionProvider.ZAPIER, credentials: { apiKey: 'k-0000000001' } }, 'credentials'],
            [
                'half a Chargebee pair',
                { provider: ConnectionProvider.CHARGEBEE, credentials: { basicAuthUser: 'cb' } },
                'credentials.basic_auth_password'
            ]
        ])('then %s is a 400 naming the field', async (_, dto, param) => {
            await expectBadRequest(harness().service.create('user-1', dto as never), param);
        });

        it('then a second live connection for the same provider is a 409', async () => {
            const { service, delegate } = harness();
            delegate.create.mockRejectedValue(uniqueViolation());

            await expect(
                service.create('user-1', { provider: ConnectionProvider.STRIPE, credentials: { signingSecret: STRIPE_SECRET } })
            ).rejects.toMatchObject({
                status: HttpStatus.CONFLICT
            });
        });
    });

    describe('when the Owner rotates the signing secret', () => {
        it('then the old secret is kept for 24 hours and connection.rotated says until when', async () => {
            const { service, delegate, scopedFindFirst, emitted } = harness();
            const before = row({ status: 'active' });
            scopedFindFirst.mockResolvedValue(before);

            await service.rotate(CONNECTION_ID, 'user-1', { credentials: { signingSecret: 'whsec_new_secret_000001' } });

            const data = delegate.update.mock.calls[0][0].data;
            expect(cipher.decrypt(data.signingSecretEncrypted)).toBe('whsec_new_secret_000001');
            expect(data.previousSigningSecretEncrypted).toBe(before.signingSecretEncrypted);
            const hours = (data.previousSecretValidUntil.getTime() - Date.now()) / 3_600_000;
            expect(hours).toBeGreaterThan(23.9);
            expect(hours).toBeLessThanOrEqual(24);
            expect(emitted[0]).toMatchObject({
                name: 'connection.rotated',
                event: { payload: { oldSecretValidUntil: data.previousSecretValidUntil } }
            });
        });

        it('then an outbound-only rotation replaces the credential with no grace period', async () => {
            const { service, delegate, scopedFindFirst, emitted } = harness();
            scopedFindFirst.mockResolvedValue(row({ provider: 'wise', direction: 'both', signingSecretEncrypted: null }));

            await service.rotate(CONNECTION_ID, 'user-1', { credentials: { apiKey: 'wise-key-000000002' } });

            expect(delegate.update.mock.calls[0][0].data).not.toHaveProperty('previousSigningSecretEncrypted');
            expect(emitted[0]!.event.payload).toMatchObject({ oldSecretValidUntil: null });
        });

        it('then an empty rotation is a 400 and a revoked connection a 404', async () => {
            const { service, scopedFindFirst } = harness();
            scopedFindFirst.mockResolvedValueOnce(row());
            await expectBadRequest(service.rotate(CONNECTION_ID, 'user-1', { credentials: {} }), 'credentials');

            scopedFindFirst.mockResolvedValueOnce(null);
            await expect(service.rotate(CONNECTION_ID, 'user-1', { credentials: { signingSecret: STRIPE_SECRET } })).rejects.toMatchObject({
                status: HttpStatus.NOT_FOUND
            });
        });
    });

    describe('when the Owner tests a connection', () => {
        it('then a passing outbound check activates a pending connection once', async () => {
            const { service, scopedFindFirst, check, emitted } = harness();
            scopedFindFirst.mockResolvedValue(
                row({ provider: 'wise', direction: 'both', credentialsEncrypted: cipher.encrypt('{"apiKey":"wise-key-1"}') })
            );

            const result = await service.test(CONNECTION_ID, 'user-1');

            expect(check).toHaveBeenCalledWith('wise', { apiKey: 'wise-key-1' }, {});
            expect(result).toMatchObject({ ok: true, status: 'active', failure: null });
            expect(emitted[0]).toMatchObject({ name: 'connection.verified', event: { payload: { source: 'test', status: 'active' } } });
        });

        it('then a failing check reports why and leaves the status alone', async () => {
            const { service, scopedFindFirst, emitted } = harness({ testFailure: 'provider answered HTTP 401' });
            scopedFindFirst.mockResolvedValue(row({ provider: 'wise', direction: 'both' }));

            await expect(service.test(CONNECTION_ID, 'user-1')).resolves.toMatchObject({
                ok: false,
                failure: 'provider answered HTTP 401',
                status: 'pending_verification'
            });
            expect(emitted).toHaveLength(0);
        });

        it('then an inbound-only connection is a 409: it activates on its first verified callback', async () => {
            const { service, scopedFindFirst } = harness();
            scopedFindFirst.mockResolvedValue(row());

            await expect(service.test(CONNECTION_ID, 'user-1')).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
        });
    });

    describe('when Event Ingestion reports the first verified callback', () => {
        it('then the connection turns active and connection.verified names the ingestion service', async () => {
            const { service, delegate, emitted } = harness();
            delegate.findFirst.mockResolvedValue(row());

            await expect(service.markVerifiedByCallback(CONNECTION_ID, 'ingestion-svc')).resolves.toEqual({
                connectionId: CONNECTION_ID,
                status: 'active'
            });
            expect(emitted[0]).toMatchObject({
                name: 'connection.verified',
                event: { userId: 'service:ingestion-svc', payload: { source: 'callback' } }
            });
        });

        it('then a later report changes nothing and announces nothing', async () => {
            const { service, delegate, emitted } = harness();
            delegate.findFirst.mockResolvedValue(row({ status: 'active' }));
            delegate.updateMany.mockResolvedValueOnce({ count: 0 });

            await expect(service.markVerifiedByCallback(CONNECTION_ID, 'ingestion-svc')).resolves.toEqual({
                connectionId: CONNECTION_ID,
                status: 'active'
            });
            expect(emitted).toHaveLength(0);
        });
    });

    describe('when Event Ingestion resolves a connection', () => {
        it('then it gets the signing secret and, within 24 hours of a rotation, the previous one', async () => {
            const { service, delegate } = harness();
            const until = new Date(Date.now() + 3_600_000);
            delegate.findFirst.mockResolvedValue(
                row({ previousSigningSecretEncrypted: cipher.encrypt('whsec_old_0000000001'), previousSecretValidUntil: until })
            );

            await expect(service.findForReceiver(ConnectionProvider.STRIPE, CONNECTION_ID)).resolves.toMatchObject({
                signingSecret: STRIPE_SECRET,
                previousSigningSecret: 'whsec_old_0000000001',
                previousSecretValidUntil: until,
                direction: 'inbound'
            });
        });

        it('then a previous secret past its 24 hours is not handed out', async () => {
            const { service, delegate } = harness();
            delegate.findFirst.mockResolvedValue(
                row({ previousSigningSecretEncrypted: cipher.encrypt('whsec_old'), previousSecretValidUntil: new Date(Date.now() - 1000) })
            );

            await expect(service.findForReceiver(ConnectionProvider.STRIPE, CONNECTION_ID)).resolves.toMatchObject({ previousSigningSecret: null });
        });

        it('then an outbound-only connection is unknown to the receiver, and nothing outbound is ever in the answer', async () => {
            const { service, delegate } = harness();
            delegate.findFirst.mockResolvedValueOnce(row({ provider: 'zapier', direction: 'outbound' }));
            await expect(service.findForReceiver(ConnectionProvider.ZAPIER, CONNECTION_ID)).resolves.toBeNull();

            delegate.findFirst.mockResolvedValueOnce(
                row({ provider: 'wise', direction: 'both', credentialsEncrypted: cipher.encrypt('{"apiKey":"wise-key-1"}') })
            );
            expect(JSON.stringify(await service.findForReceiver(ConnectionProvider.WISE, CONNECTION_ID))).not.toContain('wise-key-1');
        });
    });

    describe('when reward- or notification-service reads a credential', () => {
        it('then it gets the outbound credential and the read is audited under the calling service', async () => {
            const { service, delegate, emitted } = harness();
            delegate.findFirst.mockResolvedValue(
                row({ provider: 'wise', direction: 'both', status: 'active', credentialsEncrypted: cipher.encrypt('{"apiKey":"wise-key-1"}') })
            );

            await expect(service.credentialFor(CONNECTION_ID, 'payout-worker')).resolves.toMatchObject({
                credentials: { apiKey: 'wise-key-1' },
                status: 'active'
            });
            expect(emitted[0]).toMatchObject({ name: 'connection.credential_read', event: { userId: 'service:payout-worker' } });
        });

        it('then a revoked connection is unknown and nothing is audited', async () => {
            const { service, delegate, emitted } = harness();
            delegate.findFirst.mockResolvedValue(null);

            await expect(service.credentialFor(CONNECTION_ID, 'payout-worker')).resolves.toBeNull();
            expect(emitted).toHaveLength(0);
        });
    });

    describe('when the Owner revokes one', () => {
        it('then it is marked revoked, announced, and Event Ingestion is told through the shared Redis', async () => {
            const { service, delegate, scopedFindFirst, emitted, redisSet } = harness();
            scopedFindFirst.mockResolvedValue(row());

            await service.revoke(CONNECTION_ID, 'user-1');

            expect(delegate.update.mock.calls[0][0].data).toMatchObject({ status: 'revoked', revokedAt: expect.any(Date) });
            expect(emitted[0]).toMatchObject({ name: 'connection.revoked', event: { payload: { status: 'revoked', direction: 'inbound' } } });
            expect(redisSet).toHaveBeenCalledWith(`connection-revoked:${CONNECTION_ID}`, '1', 'EX', 3600);
        });
    });
});
