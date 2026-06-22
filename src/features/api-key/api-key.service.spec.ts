import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { ApiKeyType } from '@domains/api-key';

import { ApiKeyService } from './api-key.service';

describe('ApiKeyService', () => {
    let service: ApiKeyService;
    let prisma: MockProxy<DatabaseService>;
    let tenantAware: MockProxy<TenantAwareService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;
    let delegate: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };

    const tenantId = 'tenant-123';
    const existingKey = {
        id: 'key-1',
        tenantId,
        label: 'CI key',
        keyHash: 'oldhash',
        keyPrefix: 'old1',
        keyType: ApiKeyType.SECRET,
        scopes: ['tenant:read'],
        createdBy: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date()
    };

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        tenantAware = mock<TenantAwareService>();
        txEventEmitter = mock<TransactionEventEmitterService>();

        delegate = {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn()
        };
        tenantAware.forModel.mockReturnValue(delegate as never);
        prisma.apiKey = { findMany: jest.fn(), update: jest.fn() } as never;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ApiKeyService,
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantAwareService, useValue: tenantAware },
                { provide: TenantContextService, useValue: mock<TenantContextService>() },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() }
            ]
        }).compile();

        service = module.get(ApiKeyService);
    });

    describe('rotate', () => {
        it('issues a new secret, invalidates the old hash, and returns the raw key once', async () => {
            delegate.findUnique.mockResolvedValue(existingKey);
            delegate.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...existingKey, ...data }));

            const result = await service.rotate('key-1', 'user-1');

            expect(result.rawKey).toMatch(/^rai_live_/);
            const updateArg = delegate.update.mock.calls[0][0];
            expect(updateArg.where).toEqual({ id: 'key-1' });
            expect(updateArg.data.keyHash).toBeDefined();
            expect(updateArg.data.keyHash).not.toBe('oldhash');
            expect(updateArg.data.keyPrefix).toBe(result.rawKey.slice(-4));
            expect(updateArg.data.lastUsedAt).toBeNull();
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith('api-key.updated', expect.anything());
        });

        it('emits a publishable prefix for publishable keys', async () => {
            delegate.findUnique.mockResolvedValue({ ...existingKey, keyType: ApiKeyType.PUBLISHABLE });
            delegate.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...existingKey, ...data }));

            const result = await service.rotate('key-1', 'user-1');

            expect(result.rawKey).toMatch(/^rai_pub_/);
        });

        it('rejects rotating a revoked key', async () => {
            delegate.findUnique.mockResolvedValue({ ...existingKey, revokedAt: new Date() });
            await expect(service.rotate('key-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
        });

        it('throws NotFound when the key does not exist', async () => {
            delegate.findUnique.mockResolvedValue(null);
            await expect(service.rotate('missing', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('validateKey', () => {
        const rawKey = 'rai_live_abcdefghijklmnopqrstuvwxyz0123';

        it('returns the active key whose bcrypt hash matches', async () => {
            const keyHash = await bcrypt.hash(rawKey, 4);
            (prisma.apiKey.findMany as jest.Mock).mockResolvedValue([{ ...existingKey, keyHash, keyPrefix: rawKey.slice(-4) }]);

            const result = await service.validateKey(rawKey);

            expect(result?.id).toBe('key-1');
            expect(prisma.apiKey.findMany).toHaveBeenCalledWith({ where: { keyPrefix: rawKey.slice(-4), revokedAt: null, deletedAt: null } });
        });

        it('returns null when no candidate hash matches', async () => {
            const keyHash = await bcrypt.hash('rai_live_some_other_key_value_000000', 4);
            (prisma.apiKey.findMany as jest.Mock).mockResolvedValue([{ ...existingKey, keyHash, keyPrefix: rawKey.slice(-4) }]);

            expect(await service.validateKey(rawKey)).toBeNull();
        });

        it('throws when the matched key is expired', async () => {
            const keyHash = await bcrypt.hash(rawKey, 4);
            (prisma.apiKey.findMany as jest.Mock).mockResolvedValue([
                { ...existingKey, keyHash, keyPrefix: rawKey.slice(-4), expiresAt: new Date(Date.now() - 1000) }
            ]);

            await expect(service.validateKey(rawKey)).rejects.toBeInstanceOf(UnauthorizedException);
        });
    });
});
