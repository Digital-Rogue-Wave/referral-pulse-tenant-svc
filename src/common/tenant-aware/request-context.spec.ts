import { HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { DateService } from '@common/helper/date.service';
import type { IPrismaDelegate } from '@app/types';

import { TenantAwareService } from './tenant-aware.service';
import { TenantContextService } from './tenant-context.service';

describe('Request context', () => {
    const context = new TenantContextService(new DateService());
    const inRequest = <T>(fn: () => Promise<T>) =>
        context.runWithContext(
            {
                tenantId: 't1',
                userId: 'u1',
                requestId: 'req_1',
                correlationId: 'corr-1',
                traceId: 'trace',
                spanId: 'span',
                idempotencyKey: 'idem-1',
                ip: '203.0.113.9',
                userAgent: 'jest',
                startTime: Date.now() - 5
            },
            fn
        );

    describe('TenantContextService', () => {
        it('exposes the request context set for the async call chain', async () => {
            await inRequest(async () => {
                expect(context.isActive()).toBe(true);
                expect([context.getTenantId(), context.getUserId(), context.getRequestId(), context.getCorrelationId()]).toEqual([
                    't1',
                    'u1',
                    'req_1',
                    'corr-1'
                ]);
                expect([context.getTraceId(), context.getSpanId(), context.getIdempotencyKey(), context.getIp(), context.getUserAgent()]).toEqual([
                    'trace',
                    'span',
                    'idem-1',
                    '203.0.113.9',
                    'jest'
                ]);
                expect(context.getDuration()).toBeGreaterThanOrEqual(0);
                context.set('userId', 'u2');
                context.setMetadata('authHeader', 'Bearer x');
                expect(context.get('userId')).toBe('u2');
                expect(context.getMetadata('authHeader')).toBe('Bearer x');
                expect(context.getLogContext()).toMatchObject({ tenantId: 't1', userId: 'u2', requestId: 'req_1' });
                expect(context.snapshot()).toMatchObject({ ip: '203.0.113.9' });
            });
        });

        it('is empty outside a request', () => {
            expect(context.isActive()).toBe(false);
            expect(context.getTenantId()).toBeUndefined();
            expect(context.getDuration()).toBeUndefined();
            context.set('tenantId', 'ignored');
            context.setMetadata('k', 'v');
            expect(context.getMetadata('k')).toBeUndefined();
        });
    });

    describe('TenantAwareService', () => {
        const aware = new TenantAwareService(context);
        const delegate = {
            create: jest.fn(async (args) => args),
            findMany: jest.fn(async (args) => args),
            findUnique: jest.fn(async (args) => args),
            findFirst: jest.fn(async (args) => args),
            findFirstOrThrow: jest.fn(async (args) => args),
            update: jest.fn(async (args) => args),
            delete: jest.fn(async (args) => args),
            count: jest.fn(async (args) => args)
        };
        const scoped = aware.forModel(delegate as unknown as IPrismaDelegate<unknown>);

        it('scopes every read and write to the tenant and hides soft-deleted rows', async () => {
            await inRequest(async () => {
                await scoped.create({ data: { name: 'x' } });
                await scoped.findMany({ where: { role: 'ADMIN' } });
                await scoped.findUnique({ where: { id: '1' } });
                await scoped.findFirst({ where: { id: '1' } }, { includeSoftDeleted: true });
                await scoped.findFirstOrThrow({});
                await scoped.update({ where: { id: '1' }, data: { name: 'y' } });
                await scoped.delete({ where: { id: '1' } });
                await scoped.hardDelete({ where: { id: '1' } });
                await scoped.count({});
            });

            expect(delegate.create).toHaveBeenCalledWith({ data: { name: 'x', tenantId: 't1' } });
            expect(delegate.findMany).toHaveBeenCalledWith({ where: { role: 'ADMIN', tenantId: 't1', deletedAt: null } });
            expect(delegate.findFirst).toHaveBeenCalledWith({ where: { id: '1', tenantId: 't1' } });
            expect(delegate.update).toHaveBeenCalledWith({ where: { id: '1', tenantId: 't1' }, data: { deletedAt: expect.any(Date) } });
            expect(delegate.delete).toHaveBeenCalledWith({ where: { id: '1', tenantId: 't1' } });
        });

        it('builds tenant filters, and refuses to run without a tenant', async () => {
            await inRequest(async () => {
                expect(aware.withTenantFilter({ status: 'active' })).toEqual({ status: 'active', tenantId: 't1', deletedAt: null });
                expect(aware.withTenantFilter({}, { includeSoftDeleted: true })).toEqual({ tenantId: 't1' });
            });
            expect(aware.withSoftDelete({ a: 1 })).toEqual({ a: 1, deletedAt: null });
            expect(aware.softDeleteData().deletedAt).toBeInstanceOf(Date);

            let error: BaseException | undefined;
            try {
                aware.getRequiredTenantId();
            } catch (e) {
                error = e as BaseException;
            }
            expect(error?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        });
    });

    describe('TransactionEventEmitterService', () => {
        let emitter: EventEmitter2;
        let txEvents: TransactionEventEmitterService;
        let emitted: string[];

        beforeEach(() => {
            emitter = new EventEmitter2({ wildcard: true });
            emitted = [];
            emitter.onAny((event) => emitted.push(String(event)));
            txEvents = new TransactionEventEmitterService(emitter, context);
        });

        it('emits immediately outside a transaction', () => {
            txEvents.emitAfterCommit('a.created', {});
            txEvents.emitManyAfterCommit([{ event: 'b.created', payload: {} }]);
            expect(emitted).toEqual(['a.created', 'b.created']);
        });

        it('runs before-commit hooks inside the transaction and emits only after it commits', async () => {
            const hook = jest.fn(async () => {
                expect(emitted).toEqual([]);
            });
            txEvents.registerBeforeCommitHook(hook);
            const prisma = { $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })) };

            await inRequest(() =>
                txEvents.transaction(prisma as never, async () => {
                    txEvents.emitAfterCommit('a.created', { n: 1 });
                    txEvents.emitManyAfterCommit([{ event: 'b.created', payload: {} }]);
                    expect(context.getIp()).toBe('203.0.113.9');
                    return 'done';
                })
            );

            expect(hook).toHaveBeenCalledWith({ tx: true }, [
                { event: 'a.created', payload: { n: 1 } },
                { event: 'b.created', payload: {} }
            ]);
            expect(emitted).toEqual(['a.created', 'b.created']);
        });

        it('emits nothing when the transaction fails', async () => {
            const prisma = { $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };

            await expect(
                inRequest(() =>
                    txEvents.transaction(prisma as never, async () => {
                        txEvents.emitAfterCommit('a.created', {});
                        throw new Error('rollback');
                    })
                )
            ).rejects.toThrow('rollback');
            expect(emitted).toEqual([]);
        });

        it('emits after a batch transaction as well', async () => {
            const prisma = { $transaction: jest.fn(async (promises: unknown[]) => promises) };
            await inRequest(async () => {
                await txEvents.transaction(prisma as never, [Promise.resolve(1)] as never);
            });
            expect(prisma.$transaction).toHaveBeenCalled();
        });
    });
});
