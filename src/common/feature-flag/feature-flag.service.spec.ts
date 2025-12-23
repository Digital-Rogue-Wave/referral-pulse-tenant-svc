import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlagEntity } from './feature-flag.entity';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { createMock, DeepMocked } from '@golevelup/ts-jest';

describe('FeatureFlagService', () => {
    let service: FeatureFlagService;
    let repository: DeepMocked<Repository<FeatureFlagEntity>>;
    let redis: DeepMocked<RedisService>;

    beforeEach(async () => {
        repository = createMock<Repository<FeatureFlagEntity>>();
        redis = createMock<RedisService>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FeatureFlagService,
                {
                    provide: getRepositoryToken(FeatureFlagEntity),
                    useValue: repository
                },
                {
                    provide: RedisService,
                    useValue: redis
                }
            ]
        }).compile();

        service = module.get<FeatureFlagService>(FeatureFlagService);
    });

    describe('isEnabled', () => {
        it('should return cached value if present', async () => {
            redis.get.mockResolvedValue('true');
            const result = await service.isEnabled('fix-key', 'tenant-1');
            expect(result).toBe(true);
            expect(repository.findOne).not.toHaveBeenCalled();
        });

        it('should fetch from DB and cache if not in cache', async () => {
            redis.get.mockResolvedValue(null);
            const flag = { key: 'fix-key', defaultValue: true, overrides: {} } as any;
            repository.findOne.mockResolvedValue(flag);

            const result = await service.isEnabled('fix-key', 'tenant-1');

            expect(result).toBe(true);
            expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('fix-key'), 'true', expect.any(Number));
        });

        it('should respect overrides', async () => {
            redis.get.mockResolvedValue(null);
            const flag = {
                key: 'fix-key',
                defaultValue: true,
                overrides: { 'tenant-1': false }
            } as any;
            repository.findOne.mockResolvedValue(flag);

            const result = await service.isEnabled('fix-key', 'tenant-1');
            expect(result).toBe(false);
        });
    });

    describe('setOverride', () => {
        it('should update override and invalidate cache', async () => {
            const flag = { key: 'key', overrides: {} } as any;
            repository.findOne.mockResolvedValue(flag);

            await service.setOverride('key', 'tenant-1', true);

            expect(repository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    overrides: { 'tenant-1': true }
                })
            );
            expect(redis.del).toHaveBeenCalled();
        });
    });
});
