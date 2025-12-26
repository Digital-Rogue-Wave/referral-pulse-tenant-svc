import { Injectable } from '@nestjs/common';
import { FindOptionsRelations, FindOptionsWhere } from 'typeorm';
import { TenantSettingEntity } from '../tenant-setting.entity';
import { CreateTenantSettingDto } from '../dto/create-tenant-setting.dto';
import { UpdateTenantSettingDto } from '../dto/update-tenant-setting.dto';
import { NullableType } from '@mod/types/nullable.type';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { tenantSettingPaginationConfig } from '@mod/tenant-setting/config/tenant-setting-pagination-config';

@Injectable()
export class AwareTenantSettingService {
    constructor(
        @InjectTenantAwareRepository(TenantSettingEntity)
        private readonly repository: TenantAwareRepository<TenantSettingEntity>
    ) {}

    async create(createDto: CreateTenantSettingDto): Promise<TenantSettingEntity> {
        const setting = this.repository.createTenantContext(createDto);
        return await this.repository.saveTenantContext(setting);
    }

    async findAll(query: PaginateQuery): Promise<Paginated<TenantSettingEntity>> {
        return await this.repository.paginateTenantContext(query, this.repository, tenantSettingPaginationConfig);
    }

    async findOne(
        field: FindOptionsWhere<TenantSettingEntity>,
        relations?: FindOptionsRelations<TenantSettingEntity>
    ): Promise<NullableType<TenantSettingEntity>> {
        return await this.repository.findOneTenantContext(field, relations);
    }

    async findOneOrFail(
        field: FindOptionsWhere<TenantSettingEntity>,
        relations?: FindOptionsRelations<TenantSettingEntity>
    ): Promise<TenantSettingEntity> {
        return await this.repository.findOneOrFailTenantContext(field, relations);
    }

    async update(id: string, updateDto: UpdateTenantSettingDto): Promise<TenantSettingEntity> {
        await this.repository.updateTenantContext(id, updateDto);
        return await this.findOneOrFail({ id });
    }

    async remove(id: string): Promise<void> {
        await this.repository.deleteTenantContext({ id });
    }
}
