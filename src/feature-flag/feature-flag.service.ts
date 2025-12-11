import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { FeatureFlagEntity } from './feature-flag.entity';
import { TenantFeatureFlagEntity } from './tenant-feature-flag.entity';

@Injectable()
export class FeatureFlagService {
    private readonly CACHE_TTL = 300; // 5 minutes

    constructor(
        @InjectRepository(FeatureFlagEntity)
        private readonly featureFlagRepo: Repository<FeatureFlagEntity>,
        @InjectRepository(TenantFeatureFlagEntity)
        private readonly tenantFeatureFlagRepo: Repository<TenantFeatureFlagEntity>,
        private readonly redis: RedisService
    ) {}

    async isEnabled(key: string, tenantId: string): Promise<boolean> {
        const cacheKey = `feature_flag:${tenantId}:${key}`;
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

        const tenantOverride = await this.tenantFeatureFlagRepo.findOne({
            where: { tenantId, featureKey: key }
        });

        const isEnabled = tenantOverride ? tenantOverride.isEnabled : flagDef.defaultValue;

        await this.redis.set(cacheKey, String(isEnabled), this.CACHE_TTL);
        return isEnabled;
    }
}
