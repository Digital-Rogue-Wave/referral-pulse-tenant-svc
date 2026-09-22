import { mock, MockProxy } from 'jest-mock-extended';
import type { Prisma } from '@prisma-gen/generated/client';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { BeforeCommitHook, TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { sha256Hex } from '@common/helper/hashing';
import { DatabaseService } from '@app/database/database.service';
import { ApiKeyDeletedEvent } from '@domains/api-key';
import { TenantDeletedEvent, TenantUpdatedEvent } from '@domains/tenant/events/tenant.events';
import { TenantSettingUpdatedEvent } from '@domains/tenant-setting';
import { UserLoggedInEvent, UserRoleChangedEvent } from '@domains/user';

import { auditActor, toAuditEntry } from './audited-actions';
import { AuditLogWriter } from './audit-log.writer';

const revoked = (userId?: string) =>
    new ApiKeyDeletedEvent(
        'k1',
        't1',
        { apiKeyId: 'k1', tenantId: 't1', keyLabel: 'ci', keyPrefix: 'abcd', deletedBy: 'u1', deletedAt: new Date(), reason: 'leaked' },
        userId
    );

describe('Audited actions', () => {
    it('records a published operator action under its public name, target and reason', () => {
        expect(toAuditEntry(revoked('u1'))).toMatchObject({
            action: 'api_key.revoked',
            targetType: 'api_key',
            targetId: 'k1',
            reason: 'leaked',
            before: null
        });
    });

    it('splits a change set into before and after', () => {
        const entry = toAuditEntry(new TenantUpdatedEvent('t1', 't1', { name: { from: 'Old', to: 'New' } }, 'u1'));
        expect(entry).toMatchObject({ action: 'tenant.updated', targetType: 'tenant', before: { name: 'Old' }, after: { name: 'New' } });
    });

    it('records operator actions that are not published, such as settings changes', () => {
        const event = new TenantSettingUpdatedEvent(
            's1',
            't1',
            { settingId: 's1', tenantId: 't1', changes: { currencyCode: { from: 'EUR', to: 'USD' } }, updatedAt: new Date() },
            'u1'
        );
        expect(toAuditEntry(event)).toMatchObject({ action: 'tenant_setting.updated', targetId: 's1', after: { currencyCode: 'USD' } });
    });

    it('ignores sign-ins, which are not actions on the tenant', () => {
        expect(toAuditEntry(new UserLoggedInEvent('u1', 't1', 'password', 'u1'))).toBeNull();
    });

    it('names the operator, and records the system only for erasure', () => {
        expect(auditActor(new UserRoleChangedEvent('u2', 't1', 'viewer', 'admin', 'u1'))).toBe('u1');
        expect(auditActor(new UserRoleChangedEvent('u2', 't1', 'viewer', 'admin'))).toBeNull();
        expect(auditActor(new TenantDeletedEvent('t1', 't1', 'Acme', 'acme'))).toBe('system');
    });
});

describe('AuditLogWriter', () => {
    let prisma: MockProxy<DatabaseService>;
    let context: MockProxy<TenantContextService>;
    let txEvents: MockProxy<TransactionEventEmitterService>;
    let writer: AuditLogWriter;
    let createMany: jest.Mock;

    beforeEach(() => {
        createMany = jest.fn().mockResolvedValue({ count: 1 });
        prisma = mock<DatabaseService>();
        Object.assign(prisma, { auditLog: { createMany } });
        context = mock<TenantContextService>();
        context.getIp.mockReturnValue('203.0.113.9');
        context.getRequestId.mockReturnValue('req_01');
        txEvents = mock<TransactionEventEmitterService>();
        writer = new AuditLogWriter(prisma, txEvents, context, mock<AppLoggerService>());
    });

    it('writes the row with the transaction client before commit, with a hashed IP and the request id', async () => {
        writer.onModuleInit();
        const hook = txEvents.registerBeforeCommitHook.mock.calls[0]![0] as BeforeCommitHook;
        const txCreateMany = jest.fn().mockResolvedValue({ count: 1 });
        const event = revoked('u1');

        await hook({ auditLog: { createMany: txCreateMany } } as unknown as Prisma.TransactionClient, [{ event: 'api-key.deleted', payload: event }]);

        const [row] = (txCreateMany.mock.calls[0]![0] as { data: Prisma.AuditLogCreateManyInput[] }).data;
        expect(row).toMatchObject({
            id: event.eventId,
            tenantId: 't1',
            actorUserId: 'u1',
            action: 'api_key.revoked',
            requestId: 'req_01',
            ipHash: sha256Hex('203.0.113.9')
        });
        // Already recorded in the transaction: the post-commit emission must not write it again.
        await writer.onEmitted(event);
        expect(createMany).not.toHaveBeenCalled();
    });

    it('records an action emitted outside a transaction once, even when it is emitted under two names', async () => {
        const event = revoked('u1');
        await writer.onEmitted(event);
        await writer.onEmitted(event);
        expect(createMany).toHaveBeenCalledTimes(1);
    });

    it('writes nothing for an event without an operator', async () => {
        await writer.onEmitted(revoked());
        expect(createMany).not.toHaveBeenCalled();
    });
});
