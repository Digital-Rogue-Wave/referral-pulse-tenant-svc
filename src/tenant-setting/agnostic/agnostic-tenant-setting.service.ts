import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantSettingEntity } from '../tenant-setting.entity';
import type { TenantEntity } from '@mod/tenant/tenant.entity';

@Injectable()
export class AgnosticTenantSettingService {
    constructor(
        @InjectRepository(TenantSettingEntity)
        private readonly repository: Repository<TenantSettingEntity>
    ) {}

    /**
     * Create default settings for a new tenant
     */
    async createDefault(tenant?: TenantEntity): Promise<TenantSettingEntity> {
        return await this.repository.save({
            tenant,
            currency: { code: 'USD' } as any,
            branding: {
                primaryColor: '#000000',
                secondaryColor: '#ffffff',
                fontFamily: 'Inter'
            },
            notifications: {
                emailEnabled: true,
                webhookEnabled: false
            },
            general: {
                timezone: 'UTC',
                locale: 'en-US'
            }
        });
    }
}
