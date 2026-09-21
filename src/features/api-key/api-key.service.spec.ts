import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { RedisService } from '@common/redis/redis.service';

import { ApiKeyType } from '@domains/api-key';

import { ApiKeyService } from './api-key.service';

const PEPPER = 'p'.repeat(40);
const hmac = (raw: string): string => createHmac('sha256', PEPPER).update(raw).digest('hex');

describe('ApiKeyService', () => {
    let service: ApiKeyService;
    let prisma: MockProxy<DatabaseService>;
    let redis: MockProxy<RedisService>;
    let events: MockProxy<TransactionEventEmitterService>;
    let delegate: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    let cache: Map<string, unknown>;

    const tenantId = 'tenant-123';
    const existing = {
        id: 'key-1',
        tenantId,
        label: 'CI key',
        keyHash: hmac('rai_live_old-secret-aaaa'),
        keyPrefix: 'aaaa',
        keyType: ApiKeyType.SECRET,
        createdBy: 'user-1',
        revokedAt: null,
        deletedAt: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    beforeEach(() => {
        prisma = mock<DatabaseService>();
        redis = mock<RedisService>();
        events = mock<TransactionEventEmitterService>();
        cache = new Map();
        delegate = {
            findFirst: jest.fn().mockResolvedValue(existing),
            create: jest.fn(async ({ data }: { data: object }) => ({ ...existing, id: 'key-new', ...data })),
            update: jest.fn(async ({ data }: { data: object }) => ({ ...existing, ...data }))
        };
        const tenantAware = mock<TenantAwareService>();
        tenantAware.forModel.mockReturnValue(delegate as never);
        tenantAware.getRequiredTenantId.mockReturnValue(tenantId);
        (prisma as unknown as { apiKey: unknown }).apiKey = { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) };
        (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({ apiKey: { create: delegate.create, update: delegate.update } })
        );
        redis.get.mockImplementation(async (key: string) => cache.get(key) as never);
        redis.set.mockImplementation(async (key: string, value: unknown) => {
            cache.set(key, value);
        });
        redis.del.mockImplementation(async (key: string) => cache.delete(key));
        redis.setNx.mockResolvedValue(true);
        const config = { getOrThrow: () => PEPPER } as unknown as ConfigService;

        service = new ApiKeyService(prisma, tenantAware, events, redis, mock<AppLoggerService>(), config);
    });

    describe('when a key is created', () => {
        it('then it stores only an HMAC of the key and its last four characters, and returns the raw key once', async () => {
            const created = await service.create('user-1', { label: 'CI', keyType: ApiKeyType.PUBLISHABLE });

            expect(created.rawKey).toMatch(/^rai_pub_[A-Za-z0-9_-]{43}$/);
            const { data } = delegate.create.mock.calls[0][0] as { data: { keyHash: string; keyPrefix: string } };
            expect(data.keyHash).toBe(hmac(created.rawKey));
            expect(data.keyPrefix).toBe(created.rawKey.slice(-4));
            expect(created).not.toHaveProperty('keyHash');
            expect(events.emitAfterCommit).toHaveBeenCalledWith('api-key.created', expect.anything());
        });

        it('then a clash on the tenant’s 4-char display suffix is regenerated rather than surfaced', async () => {
            const clash = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '7' });
            delegate.create.mockRejectedValueOnce(clash);

            await service.create('user-1', { label: 'CI' });

            expect(delegate.create).toHaveBeenCalledTimes(2);
        });
    });

    describe('when a presented key is validated', () => {
        const raw = 'rai_live_old-secret-aaaa';

        it('then it is one indexed lookup by hash, cached for the next request', async () => {
            (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
                id: 'key-1',
                tenantId,
                keyType: 'secret',
                expiresAt: null,
                revokedAt: null,
                deletedAt: null
            });

            expect(await service.validateKey(raw)).toEqual({ id: 'key-1', tenantId, keyType: 'secret' });
            expect(await service.validateKey(raw)).toEqual({ id: 'key-1', tenantId, keyType: 'secret' });

            expect(prisma.apiKey.findUnique).toHaveBeenCalledTimes(1);
            expect(prisma.apiKey.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { keyHash: hmac(raw) } }));
            expect([...cache.keys()]).toEqual([`apikey:aaaa:${hmac(raw).slice(0, 8)}`]);
        });

        it.each([
            ['unknown', null],
            ['revoked', { id: 'k', tenantId, keyType: 'secret', expiresAt: null, revokedAt: new Date(), deletedAt: new Date() }],
            ['expired', { id: 'k', tenantId, keyType: 'secret', expiresAt: new Date(Date.now() - 1000), revokedAt: null, deletedAt: null }]
        ])('then an %s key is rejected', async (_case, row) => {
            (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(row);
            expect(await service.validateKey(raw)).toBeNull();
        });

        it('then last_used_at is written at most once a minute per key', async () => {
            (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
                id: 'key-1',
                tenantId,
                keyType: 'secret',
                expiresAt: null,
                revokedAt: null,
                deletedAt: null
            });
            redis.setNx.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

            await service.validateKey(raw);
            await service.validateKey(raw);

            expect(prisma.apiKey.update).toHaveBeenCalledTimes(1);
        });
    });

    describe('when a key is revoked', () => {
        it('then it stops validating immediately — the cache entry is dropped — and the reason is carried on the event', async () => {
            cache.set(`apikey:aaaa:${existing.keyHash.slice(0, 8)}`, { id: 'key-1', tenantId, keyType: 'secret', expiresAt: null });

            await service.delete('key-1', 'user-1', 'leaked in a public repo');

            expect(cache.size).toBe(0);
            expect(delegate.update).toHaveBeenCalledWith({
                where: { id: 'key-1' },
                data: { revokedAt: expect.any(Date), deletedAt: expect.any(Date) }
            });
            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'api-key.deleted',
                expect.objectContaining({ payload: expect.objectContaining({ reason: 'leaked in a public repo' }) })
            );
        });
    });

    describe('when a key is rotated', () => {
        it('then the old secret stops working, a new one is returned once and api_key.rotated is emitted', async () => {
            cache.set(`apikey:aaaa:${existing.keyHash.slice(0, 8)}`, { id: 'key-1' });

            const rotated = await service.rotate('key-1', 'user-1');

            expect(rotated.rawKey).toMatch(/^rai_live_/);
            expect(delegate.update).toHaveBeenCalledWith({
                where: { id: 'key-1' },
                data: { keyHash: hmac(rotated.rawKey), keyPrefix: rotated.rawKey.slice(-4), lastUsedAt: null }
            });
            expect(cache.size).toBe(0);
            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'api-key.rotated',
                expect.objectContaining({ payload: expect.objectContaining({ oldKeyPrefix: 'aaaa' }) })
            );
        });

        it('then a revoked key cannot be rotated', async () => {
            delegate.findFirst.mockResolvedValue({ ...existing, revokedAt: new Date() });
            const error = await service.rotate('key-1', 'user-1').catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.CONFLICT);
        });

        it('then an unknown key is not found', async () => {
            delegate.findFirst.mockResolvedValue(null);
            const error = await service.rotate('nope', 'user-1').catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        });
    });
});
