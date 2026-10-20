import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma-gen/generated/client';

import { ConnectionProvider, ConnectionType, receiverPath } from '@domains/connection';

import { ConnectionService } from './connection.service';
import { ProviderSecretCipher } from './provider-secret.cipher';

const TENANT_ID = '01HQZX000000000000000TEN';
const CONNECTION_ID = '01HQZX000000000000000CON';
const KEY_HEX = 'a'.repeat(64);

const cipherWith = (keyHex: string | undefined): ProviderSecretCipher =>
    new ProviderSecretCipher({ get: () => keyHex } as unknown as ConfigService<never>);

const uniqueViolation = (): Prisma.PrismaClientKnownRequestError =>
    new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.4.0' });

const row = (overrides: Record<string, unknown> = {}) => ({
    id: CONNECTION_ID,
    tenantId: TENANT_ID,
    provider: ConnectionProvider.STRIPE,
    connectionType: ConnectionType.BILLING,
    name: 'Stripe live',
    signingSecret: null,
    config: {},
    enabled: true,
    createdBy: 'user-1',
    createdAt: new Date('2026-10-19T10:00:00Z'),
    updatedAt: new Date('2026-10-19T10:00:00Z'),
    revokedAt: null,
    ...overrides
});

interface Harness {
    service: ConnectionService;
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
    scopedFindFirst: jest.Mock;
    emitted: { name: string; event: unknown }[];
}

const harness = (cipher: ProviderSecretCipher = cipherWith(KEY_HEX)): Harness => {
    const create = jest.fn().mockResolvedValue(row());
    const update = jest.fn().mockResolvedValue(row({ revokedAt: new Date() }));
    const findFirst = jest.fn();
    const scopedFindFirst = jest.fn();
    const emitted: { name: string; event: unknown }[] = [];

    const delegate = { create, update, findFirst };
    const prisma = {
        providerConnection: delegate,
        $transaction: (fn: (tx: unknown) => unknown) => fn({ providerConnection: delegate })
    };

    const service = new ConnectionService(
        prisma as never,
        {
            getRequiredTenantId: () => TENANT_ID,
            forModel: () => ({ findFirst: scopedFindFirst, findMany: jest.fn().mockResolvedValue([]) })
        } as never,
        { emitAfterCommit: (name: string, event: unknown) => emitted.push({ name, event }) } as never,
        cipher,
        { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as never
    );

    return { service, create, update, findFirst, scopedFindFirst, emitted };
};

describe('Provider connections', () => {
    describe('given a new Stripe connection', () => {
        it('then the secret is stored encrypted, never in the clear', async () => {
            const { service, create } = harness();

            await service.create('user-1', {
                provider: ConnectionProvider.STRIPE,
                connectionType: ConnectionType.BILLING,
                signingSecret: 'whsec_live_abcdefghijklmnop'
            });

            const stored = create.mock.calls[0][0].data.signingSecret as string;
            expect(stored).not.toContain('whsec_live_abcdefghijklmnop');
            expect(cipherWith(KEY_HEX).decrypt(stored)).toBe('whsec_live_abcdefghijklmnop');
        });

        it('then the response carries the receiver URL and not the secret', async () => {
            const { service } = harness();

            const response = await service.create('user-1', {
                provider: ConnectionProvider.STRIPE,
                connectionType: ConnectionType.BILLING,
                signingSecret: 'whsec_live_abcdefghijklmnop'
            });

            expect(response.receiverUrl).toBe(`/inbound/stripe/${CONNECTION_ID}`);
            expect(JSON.stringify(response)).not.toContain('whsec_live');
        });

        it('then `connection.created` is emitted for the ingestion cache, without the secret', async () => {
            const { service, emitted } = harness();

            await service.create('user-1', {
                provider: ConnectionProvider.STRIPE,
                connectionType: ConnectionType.BILLING,
                signingSecret: 'whsec_live_abcdefghijklmnop'
            });

            expect(emitted).toHaveLength(1);
            expect(emitted[0]!.name).toBe('connection.created');
            expect(JSON.stringify(emitted[0]!.event)).not.toContain('whsec_live');
        });
    });

    describe('given a tenant that already has a live Stripe connection', () => {
        it("then a second one is a 409, so it cannot take over the first one's callbacks", async () => {
            const { service, create } = harness();
            create.mockRejectedValue(uniqueViolation());

            await expect(
                service.create('user-1', {
                    provider: ConnectionProvider.STRIPE,
                    connectionType: ConnectionType.BILLING,
                    signingSecret: 'whsec_live_abcdefghijklmnop'
                })
            ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
        });
    });

    describe('given no encryption key configured', () => {
        it('then creating a connection fails loudly rather than storing an unreadable secret', async () => {
            const { service, create } = harness(cipherWith(undefined));

            await expect(
                service.create('user-1', {
                    provider: ConnectionProvider.STRIPE,
                    connectionType: ConnectionType.BILLING,
                    signingSecret: 'whsec_live_abcdefghijklmnop'
                })
            ).rejects.toThrow('PROVIDER_SECRET_ENCRYPTION_KEY');
            expect(create).not.toHaveBeenCalled();
        });
    });

    describe('given the receiver resolving a callback', () => {
        it('then the secret comes back decrypted, because verification needs the raw value', async () => {
            const { service, findFirst } = harness();
            findFirst.mockResolvedValue(row({ signingSecret: cipherWith(KEY_HEX).encrypt('whsec_live_abcdefghijklmnop') }));

            const resolved = await service.findForReceiver(ConnectionProvider.STRIPE, CONNECTION_ID);

            expect(resolved?.signingSecret).toBe('whsec_live_abcdefghijklmnop');
            expect(resolved?.tenantId).toBe(TENANT_ID);
        });

        it('then a revoked or disabled connection is not resolvable — the 404 the provider is owed', async () => {
            const { service, findFirst } = harness();
            findFirst.mockResolvedValue(null);

            await expect(service.findForReceiver(ConnectionProvider.STRIPE, CONNECTION_ID)).resolves.toBeNull();
            expect(findFirst.mock.calls[0]![0].where).toMatchObject({ enabled: true, revokedAt: null });
        });

        it('then it looks up across tenants, because a provider callback carries no tenant context', async () => {
            const { service, findFirst, scopedFindFirst } = harness();
            findFirst.mockResolvedValue(row());

            await service.findForReceiver(ConnectionProvider.STRIPE, CONNECTION_ID);

            expect(findFirst).toHaveBeenCalled();
            expect(scopedFindFirst).not.toHaveBeenCalled();
        });
    });

    describe('given a revocation', () => {
        it('then the row is kept and disabled, so sent receipts stay attributable', async () => {
            const { service, update, scopedFindFirst, emitted } = harness();
            scopedFindFirst.mockResolvedValue(row());

            await service.revoke(CONNECTION_ID, 'user-2');

            expect(update.mock.calls[0][0].data).toMatchObject({ enabled: false });
            expect(update.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
            expect(emitted.map((e) => e.name)).toEqual(['connection.revoked']);
        });

        it('then revoking an unknown connection is a 404', async () => {
            const { service, scopedFindFirst } = harness();
            scopedFindFirst.mockResolvedValue(null);

            await expect(service.revoke(CONNECTION_ID, 'user-2')).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
        });
    });

    describe('given the receiver path', () => {
        it('then it is the path Event Ingestion hosts (API Contract §6.5)', () => {
            expect(receiverPath('paddle', CONNECTION_ID)).toBe(`/inbound/paddle/${CONNECTION_ID}`);
        });
    });
});

describe('The provider secret cipher', () => {
    describe('given a secret', () => {
        it('then each encryption differs, because the IV is fresh', () => {
            const cipher = cipherWith(KEY_HEX);

            expect(cipher.encrypt('same-secret')).not.toBe(cipher.encrypt('same-secret'));
        });

        it('then a tampered ciphertext is refused rather than returning garbage', () => {
            const cipher = cipherWith(KEY_HEX);
            const stored = Buffer.from(cipher.encrypt('whsec_live_abcdefghijklmnop'), 'base64');
            stored[stored.length - 1] = stored[stored.length - 1]! ^ 0xff;

            expect(() => cipher.decrypt(stored.toString('base64'))).toThrow();
        });

        it('then a key of the wrong length is refused', () => {
            expect(() => cipherWith('abcd').encrypt('secret')).toThrow('PROVIDER_SECRET_ENCRYPTION_KEY');
        });
    });
});
