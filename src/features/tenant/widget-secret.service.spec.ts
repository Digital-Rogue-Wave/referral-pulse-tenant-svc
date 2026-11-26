import { ServiceUnavailableException } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { WidgetSecretService } from './widget-secret.service';
import { StoredSigningSecret, WidgetSecretVault } from './widget-secret.vault';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** v5.2 US1.5.5: the Owner's read and rotation with two kids and a 7-day grace, Event Ingestion's read, sealing at rest. */
describe('WidgetSecretService', () => {
    const LEGACY = 'b'.repeat(64);
    const now = Date.now();
    let service: WidgetSecretService;
    let events: MockProxy<TransactionEventEmitterService>;
    let tx: { tenant: { findFirst: jest.Mock; update: jest.Mock } };
    // A transparent stand-in for AES: sealing prefixes, opening strips. Plain 64-hex counts as legacy.
    const vault = new WidgetSecretVault({ encrypt: (raw: string) => 'sealed:' + raw, decrypt: (sealed: string) => sealed.slice(7) } as never);
    jest.spyOn(vault, 'mint').mockImplementation((createdAt: Date) => ({
        raw: 'c'.repeat(64),
        stored: { kid: 'kid-new', secret_encrypted: 'sealed:' + 'c'.repeat(64), created_at: createdAt }
    }));

    const entry = (kid: string, secret: string, createdAt: number) => ({
        kid,
        secret_encrypted: secret,
        created_at: new Date(createdAt).toISOString()
    });
    const storedAs = (...entries: ReturnType<typeof entry>[]) => ({ widgetSigningSecrets: entries });

    beforeEach(() => {
        const prisma = mock<DatabaseService>();
        tx = {
            tenant: {
                findFirst: jest.fn().mockResolvedValue(storedAs(entry('kid-a', 'sealed:' + 'a'.repeat(64), now - 30 * DAY_MS))),
                update: jest.fn()
            }
        };
        (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
        events = mock<TransactionEventEmitterService>();
        service = new WidgetSecretService(prisma, vault, events, mock<AppLoggerService>());
    });

    it('the Owner reads the secret with its kid, and the read is recorded for the audit trail', async () => {
        await expect(service.reveal('t1', 'owner-1')).resolves.toEqual({
            secrets: [{ kid: 'kid-a', secret: 'a'.repeat(64), createdAt: new Date(now - 30 * DAY_MS), expiresAt: null }]
        });
        expect(events.emitAfterCommit).toHaveBeenCalledWith(
            'tenant.widget_secret_revealed',
            expect.objectContaining({ tenantId: 't1', userId: 'owner-1' })
        );
    });

    it('a legacy plain value is sealed in place the first time it is read', async () => {
        tx.tenant.findFirst.mockResolvedValue(storedAs(entry('kid-a', LEGACY, now)));

        const { secrets } = await service.forService('t1');

        expect(secrets[0]!.secret).toBe(LEGACY);
        const written = tx.tenant.update.mock.calls[0]![0].data.widgetSigningSecrets as StoredSigningSecret[];
        expect(written[0]!.secret_encrypted).toBe('sealed:' + LEGACY);
    });

    it('rotation puts a new kid first, keeps the replaced one for 7 days, drops any older one, and announces it without a secret', async () => {
        tx.tenant.findFirst.mockResolvedValue(
            storedAs(entry('kid-a', 'sealed:' + 'a'.repeat(64), now - DAY_MS), entry('kid-old', 'sealed:' + 'd'.repeat(64), now - 9 * DAY_MS))
        );

        const { secrets } = await service.rotate('t1', 'owner-1');

        expect(secrets.map((s) => s.kid)).toEqual(['kid-new', 'kid-a']);
        expect(secrets[0]).toMatchObject({ secret: 'c'.repeat(64), expiresAt: null });
        const graceDays = (secrets[1]!.expiresAt!.getTime() - secrets[0]!.createdAt.getTime()) / DAY_MS;
        expect(graceDays).toBe(7);
        const written = tx.tenant.update.mock.calls[0]![0].data.widgetSigningSecrets as StoredSigningSecret[];
        expect(written.map((s) => s.kid)).toEqual(['kid-new', 'kid-a']);
        // Stored as plain ISO strings: Prisma would wrap a Date inside Json as {"$type": "DateTime"}.
        expect(written.map((s) => typeof s.created_at)).toEqual(['string', 'string']);
        const [, event] = events.emitAfterCommit.mock.calls.find(([name]) => name === 'tenant.widget_secret_rotated')!;
        expect(event).toMatchObject({ kid: 'kid-new' });
        expect(JSON.stringify(event)).not.toContain('c'.repeat(64));
    });

    it('the previous kid is served until 7 days after the rotation, then only the newest', async () => {
        const previous = entry('kid-old', 'sealed:' + 'd'.repeat(64), now - 20 * DAY_MS);
        tx.tenant.findFirst.mockResolvedValue(storedAs(entry('kid-a', 'sealed:' + 'a'.repeat(64), now - 6 * DAY_MS), previous));
        await expect(service.forService('t1').then((r) => r.secrets.map((s) => s.kid))).resolves.toEqual(['kid-a', 'kid-old']);

        tx.tenant.findFirst.mockResolvedValue(storedAs(entry('kid-a', 'sealed:' + 'a'.repeat(64), now - 7 * DAY_MS - 1_000), previous));
        await expect(service.forService('t1').then((r) => r.secrets.map((s) => s.kid))).resolves.toEqual(['kid-a']);
    });

    it('a tenant with no secret is a 503, never an empty list', async () => {
        tx.tenant.findFirst.mockResolvedValue(storedAs());
        await expect(service.forService('t1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
});
