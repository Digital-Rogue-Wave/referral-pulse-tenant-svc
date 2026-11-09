import { ServiceUnavailableException } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { WidgetSecretService } from './widget-secret.service';
import { WidgetSecretVault } from './widget-secret.vault';

/** US1.5.4 F2/F3/F5: the Owner's read and rotation, Event Ingestion's read, and sealing at rest. */
describe('WidgetSecretService', () => {
    const LEGACY = 'b'.repeat(64);
    const now = Date.now();
    let service: WidgetSecretService;
    let events: MockProxy<TransactionEventEmitterService>;
    let tx: { tenant: { findFirst: jest.Mock; update: jest.Mock } };
    // A transparent stand-in for AES: sealing prefixes, opening strips. Plain 64-hex counts as legacy.
    const vault = {
        generate: () => ({ raw: 'c'.repeat(64), sealed: 'sealed:' + 'c'.repeat(64) }),
        seal: (raw: string) => 'sealed:' + raw,
        open: (stored: string) => (stored.startsWith('sealed:') ? { raw: stored.slice(7), legacy: false } : { raw: stored, legacy: true })
    } as unknown as WidgetSecretVault;

    const row = (over: Record<string, unknown> = {}) => ({
        widgetTokenSecret: 'sealed:' + 'a'.repeat(64),
        widgetTokenSecretPrevious: null,
        widgetTokenSecretPreviousUntil: null,
        ...over
    });

    beforeEach(() => {
        const prisma = mock<DatabaseService>();
        tx = { tenant: { findFirst: jest.fn().mockResolvedValue(row()), update: jest.fn() } };
        (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
        events = mock<TransactionEventEmitterService>();
        service = new WidgetSecretService(prisma, vault, events, mock<AppLoggerService>());
    });

    it('the Owner reads the plain secret, and the read is recorded for the audit trail', async () => {
        await expect(service.reveal('t1', 'owner-1')).resolves.toEqual({ secret: 'a'.repeat(64), previousValidUntil: null });
        expect(events.emitAfterCommit).toHaveBeenCalledWith(
            'tenant.widget_secret_revealed',
            expect.objectContaining({ tenantId: 't1', userId: 'owner-1' })
        );
    });

    it('a legacy plain value is sealed in place the first time it is read', async () => {
        tx.tenant.findFirst.mockResolvedValue(row({ widgetTokenSecret: LEGACY }));

        await expect(service.forService('t1')).resolves.toEqual({ secret: LEGACY });
        expect(tx.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { widgetTokenSecret: 'sealed:' + LEGACY } });
    });

    it('rotation stores a new sealed secret, keeps the old one for an hour, and announces it without the secret', async () => {
        const result = await service.rotate('t1', 'owner-1');

        expect(result.secret).toBe('c'.repeat(64));
        const until = result.previousValidUntil!.getTime();
        expect(until).toBeGreaterThanOrEqual(now + 59 * 60_000);
        expect(until).toBeLessThanOrEqual(Date.now() + 60 * 60_000);
        expect(tx.tenant.update).toHaveBeenCalledWith({
            where: { id: 't1' },
            data: {
                widgetTokenSecret: 'sealed:' + 'c'.repeat(64),
                widgetTokenSecretPrevious: 'sealed:' + 'a'.repeat(64),
                widgetTokenSecretPreviousUntil: result.previousValidUntil
            }
        });
        const [, event] = events.emitAfterCommit.mock.calls.find(([name]) => name === 'tenant.widget_secret_rotated')!;
        expect(JSON.stringify(event)).not.toContain('c'.repeat(64));
    });

    it('Event Ingestion gets the previous secret only while it is still accepted', async () => {
        const inside = new Date(now + 30 * 60_000);
        tx.tenant.findFirst.mockResolvedValue(row({ widgetTokenSecretPrevious: 'sealed:' + 'd'.repeat(64), widgetTokenSecretPreviousUntil: inside }));
        await expect(service.forService('t1')).resolves.toEqual({
            secret: 'a'.repeat(64),
            previousSecret: 'd'.repeat(64),
            previousValidUntil: inside
        });

        tx.tenant.findFirst.mockResolvedValue(
            row({ widgetTokenSecretPrevious: 'sealed:' + 'd'.repeat(64), widgetTokenSecretPreviousUntil: new Date(now - 1_000) })
        );
        await expect(service.forService('t1')).resolves.toEqual({ secret: 'a'.repeat(64) });
    });

    it('a tenant with no secret is a 503, never an empty secret', async () => {
        tx.tenant.findFirst.mockResolvedValue(row({ widgetTokenSecret: null }));
        await expect(service.forService('t1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
});
