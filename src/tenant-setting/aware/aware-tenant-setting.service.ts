import { Injectable } from '@nestjs/common';
import { FindOptionsRelations, FindOptionsWhere } from 'typeorm';
import { TenantSettingEntity } from '../tenant-setting.entity';
import { CreateTenantSettingDto } from '../dto/create-tenant-setting.dto';
import { UpdateTenantSettingDto } from '../dto/update-tenant-setting.dto';
import { NullableType } from '@mod/types/nullable.type';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';

@Injectable()
export class AwareTenantSettingService {
    constructor(
        @InjectTenantAwareRepository(TenantSettingEntity)
        private readonly repository: TenantAwareRepository<TenantSettingEntity>
    ) {}

    async create(createDto: CreateTenantSettingDto): Promise<TenantSettingEntity> {
        return this.repository.saveTenantContext(this.repository.createTenantContext(createDto));
    }

    async findAll(): Promise<TenantSettingEntity[]> {
        return this.repository.findTenantContext();
    }

    async findOne(
        field: FindOptionsWhere<TenantSettingEntity>,
        relations?: FindOptionsRelations<TenantSettingEntity>
    ): Promise<NullableType<TenantSettingEntity>> {
        return this.repository.findOneTenantContext(field, relations);
    }

    async findOneOrFail(
        field: FindOptionsWhere<TenantSettingEntity>,
        relations?: FindOptionsRelations<TenantSettingEntity>
    ): Promise<TenantSettingEntity> {
        return this.repository.findOneOrFailTenantContext(field, relations);
    }

    async update(id: string, updateDto: UpdateTenantSettingDto): Promise<TenantSettingEntity> {
        await this.repository.update(id, updateDto);
        return this.findOneOrFail({ id });
    }

    async remove(id: string): Promise<void> {
        await this.repository.deleteTenantContext({ id });
    }
}
