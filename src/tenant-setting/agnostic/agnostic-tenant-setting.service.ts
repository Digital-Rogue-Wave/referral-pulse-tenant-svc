import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantSettingEntity } from '../tenant-setting.entity';

@Injectable()
export class AgnosticTenantSettingService {
    constructor(
        @InjectRepository(TenantSettingEntity)
        private readonly repository: Repository<TenantSettingEntity>
    ) {}

    /**
     * Create default settings for a new tenant
     */
    async createDefault(): Promise<TenantSettingEntity> {
        return await this.repository.save({
            currencyCode: 'USD',
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
