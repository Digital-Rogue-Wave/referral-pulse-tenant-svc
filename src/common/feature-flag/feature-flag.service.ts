import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { FeatureFlagEntity } from './feature-flag.entity';

@Injectable()
export class FeatureFlagService {
    private readonly CACHE_TTL = 300; // 5 minutes

    constructor(
        @InjectRepository(FeatureFlagEntity)
        private readonly featureFlagRepo: Repository<FeatureFlagEntity>,
        private readonly redis: RedisService
    ) {}

    async isEnabled(key: string, entityId: string): Promise<boolean> {
        const cacheKey = `feature_flag:${entityId}:${key}`;
        const cached = await this.redis.get(cacheKey);

        if (cached !== null) {
            return cached === 'true';
        }

        // Fetch from DB
        const flagDef = await this.featureFlagRepo.findOne({ where: { key } });
        if (!flagDef) {
            // Flag not defined, assume false and cache
            await this.redis.set(cacheKey, 'false', this.CACHE_TTL);
            return false;
        }

        // Check entity-specific override from JSONB column
        const isEnabled = flagDef.overrides?.[entityId] ?? flagDef.defaultValue;

        await this.redis.set(cacheKey, String(isEnabled), this.CACHE_TTL);
        return isEnabled;
    }

    async setOverride(key: string, entityId: string, isEnabled: boolean): Promise<void> {
        const flagDef = await this.featureFlagRepo.findOne({ where: { key } });
        if (!flagDef) {
            throw new Error(`Feature flag with key '${key}' not found`);
        }

        flagDef.overrides = {
            ...flagDef.overrides,
            [entityId]: isEnabled
        };

        await this.featureFlagRepo.save(flagDef);

        // Invalidate cache
        const cacheKey = `feature_flag:${entityId}:${key}`;
        await this.redis.del(cacheKey);
    }

    async removeOverride(key: string, entityId: string): Promise<void> {
        const flagDef = await this.featureFlagRepo.findOne({ where: { key } });
        if (!flagDef) {
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [entityId]: _, ...remainingOverrides } = flagDef.overrides;
        flagDef.overrides = remainingOverrides;

        await this.featureFlagRepo.save(flagDef);

        // Invalidate cache
        const cacheKey = `feature_flag:${entityId}:${key}`;
        await this.redis.del(cacheKey);
    }
}
