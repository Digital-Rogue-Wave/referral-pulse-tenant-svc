import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyService } from './api-key.service';
import { ApiKeyEntity } from './api-key.entity';
import { TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SharedService } from '@mod/common/shared.service';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ApiKeyStatusEnum } from '@mod/common/enums/api-key.enum';
import Stubber from '@mod/common/mock/typeorm-faker';

describe('ApiKeyService', () => {
    let service: ApiKeyService;
    let repository: DeepMocked<TenantAwareRepository<ApiKeyEntity>>;
    let eventEmitter: DeepMocked<EventEmitter2>;
    let sharedService: DeepMocked<SharedService>;

    const userId = 'user-123';
    const tenantId = 'tenant-123';

    beforeEach(async () => {
        repository = createMock<TenantAwareRepository<ApiKeyEntity>>();
        eventEmitter = createMock<EventEmitter2>();
        sharedService = createMock<SharedService>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ApiKeyService,
                {
                    provide: 'TenantAwareRepository_ApiKeyEntity',
                    useValue: repository
                },
                {
                    provide: EventEmitter2,
                    useValue: eventEmitter
                },
                {
                    provide: SharedService,
                    useValue: sharedService
                }
            ]
        }).compile();

        service = module.get<ApiKeyService>(ApiKeyService);
    });

    describe('create', () => {
        it('should create and return a new API key', async () => {
            const rawKey = 'sk_live_12345';
            const hash = 'hashed_key';
            const prefix = 'sk_live';

            sharedService.generateSecureApiKey.mockReturnValue(rawKey);
            sharedService.hashApiKey.mockResolvedValue(hash);
            sharedService.extractApiKeyPrefix.mockReturnValue(prefix);

            const createDto = { name: 'Test Key', scopes: ['read'], expiresAt: new Date() };
            const savedKey = Stubber.stubOne(ApiKeyEntity, {
                ...createDto,
                id: 'key-1',
                keyHash: hash,
                keyPrefix: prefix,
                tenantId,
                status: ApiKeyStatusEnum.ACTIVE
            });

            repository.createTenantContext.mockReturnValue(savedKey);
            repository.saveTenantContext.mockResolvedValue(savedKey);

            const result = await service.create(userId, createDto);

            expect(result).toBe(savedKey);
            expect(result.keyHash).toBe(hash);
            expect(sharedService.hashApiKey).toHaveBeenCalledWith(rawKey);
            expect(eventEmitter.emitAsync).toHaveBeenCalledWith('api-key.created', expect.anything());
        });
    });

    describe('validateKey', () => {
        it('should validate a correct API key and update lastUsedAt', async () => {
            const rawKey = 'sk_live_valid';
            const prefix = 'sk_live';
            const hash = 'valid_hash';

            const apiKey = Stubber.stubOne(ApiKeyEntity, {
                id: 'key-1',
                keyHash: hash,
                keyPrefix: prefix,
                status: ApiKeyStatusEnum.ACTIVE,
                expiresAt: new Date(Date.now() + 100000)
            });

            sharedService.extractApiKeyPrefix.mockReturnValue(prefix);
            sharedService.compareApiKeys.mockResolvedValue(true);

            // Mock QueryBuilder chain
            const queryBuilder = {
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getOne: jest.fn<any>().mockResolvedValue(apiKey)
            };
            repository.createQueryBuilder.mockReturnValue(queryBuilder as any);

            // Mock update functionality
            repository.update.mockResolvedValue({ affected: 1 } as any);

            const result = await service.validateKey(rawKey);

            expect(result).toBe(apiKey);
            expect(repository.createQueryBuilder).toHaveBeenCalledWith('k');
            expect(queryBuilder.where).toHaveBeenCalledWith('k.keyPrefix = :keyPrefix', { keyPrefix: prefix });
            expect(sharedService.compareApiKeys).toHaveBeenCalledWith(rawKey, hash);

            await new Promise((resolve) => setImmediate(resolve));
            expect(repository.update).toHaveBeenCalledWith('key-1', expect.objectContaining({ lastUsedAt: expect.any(Date) }));
        });

        it('should return null for invalid hash', async () => {
            const rawKey = 'sk_live_invalid';
            const apiKey = Stubber.stubOne(ApiKeyEntity, { id: 'key-1', keyHash: 'real_hash', keyPrefix: 'sk_live' });

            sharedService.extractApiKeyPrefix.mockReturnValue('sk_live');

            const queryBuilder = {
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getOne: jest.fn<any>().mockResolvedValue(apiKey)
            };
            repository.createQueryBuilder.mockReturnValue(queryBuilder as any);
            sharedService.compareApiKeys.mockResolvedValue(false);

            const result = await service.validateKey(rawKey);
            expect(result).toBeNull();
            expect(sharedService.compareApiKeys).toHaveBeenCalled();
        });

        it('should return null for expired key', async () => {
            const rawKey = 'sk_live_expired';
            const apiKey = Stubber.stubOne(ApiKeyEntity, {
                id: 'key-1',
                keyHash: 'real_hash',
                expiresAt: new Date(Date.now() - 10000) // Expired
            });

            sharedService.extractApiKeyPrefix.mockReturnValue('sk_live');

            const queryBuilder = {
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getOne: jest.fn<any>().mockResolvedValue(apiKey)
            };
            repository.createQueryBuilder.mockReturnValue(queryBuilder as any);
            sharedService.compareApiKeys.mockResolvedValue(true);

            const result = await service.validateKey(rawKey);
            expect(result).toBeNull();
        });
    });

    describe('update', () => {
        it('should update key name and emit event', async () => {
            const apiKey = Stubber.stubOne(ApiKeyEntity, { id: 'key-1', name: 'Old Name' });
            repository.findOneOrFailTenantContext.mockResolvedValue(apiKey);
            repository.saveTenantContext.mockResolvedValue(Stubber.stubOne(ApiKeyEntity, { ...apiKey, name: 'New Name' }));

            const result = await service.update('key-1', userId, { name: 'New Name' });
            expect(result.name).toBe('New Name');
            expect(eventEmitter.emitAsync).toHaveBeenCalledWith('api-key.updated', expect.anything());
        });
    });

    describe('delete', () => {
        it('should delete key and emit event', async () => {
            const apiKey = Stubber.stubOne(ApiKeyEntity, { id: 'key-1', tenantId: 't-1' });
            repository.findOneOrFailTenantContext.mockResolvedValue(apiKey);
            repository.deleteTenantContext.mockResolvedValue({ affected: 1 } as any);

            await service.delete('key-1', userId);
            expect(repository.deleteTenantContext).toHaveBeenCalledWith({ id: 'key-1' });
            expect(eventEmitter.emitAsync).toHaveBeenCalledWith('api-key.deleted', expect.anything());
        });
    });
});
