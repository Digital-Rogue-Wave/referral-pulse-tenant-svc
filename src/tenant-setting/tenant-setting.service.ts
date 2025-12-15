import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, FindOptionsWhere, Repository } from 'typeorm';
import { TenantSettingEntity } from './tenant-setting.entity';
import { CreateTenantSettingDto } from './dto/create-tenant-setting.dto';
import { UpdateTenantSettingDto } from './dto/update-tenant-setting.dto';
import { NullableType } from '@mod/types/nullable.type';

@Injectable()
export class TenantSettingService {
    constructor(
        @InjectRepository(TenantSettingEntity)
        private readonly repository: Repository<TenantSettingEntity>
    ) {}

    async create(createDto: CreateTenantSettingDto): Promise<TenantSettingEntity> {
        return this.repository.save(this.repository.create(createDto));
    }

    async findAll(): Promise<TenantSettingEntity[]> {
        return this.repository.find();
    }

    async findOne(
        field: FindOptionsWhere<TenantSettingEntity>,
        relations?: FindOptionsRelations<TenantSettingEntity>
    ): Promise<NullableType<TenantSettingEntity>> {
        return this.repository.findOne({ where: field, relations });
    }

    async findOneOrFail(
        field: FindOptionsWhere<TenantSettingEntity>,
        relations?: FindOptionsRelations<TenantSettingEntity>
    ): Promise<TenantSettingEntity> {
        return this.repository.findOneOrFail({ where: field, relations });
    }

    async update(id: string, updateDto: UpdateTenantSettingDto): Promise<TenantSettingEntity> {
        await this.repository.update(id, updateDto);
        return this.findOneOrFail({ id });
    }

    async remove(id: string): Promise<void> {
        await this.repository.delete(id);
    }

    /**
     * Create default settings for a new tenant
     */
    async createDefault(): Promise<TenantSettingEntity> {
        return await this.create({
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
