import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import slugify from 'slugify';
import { DeleteResult, Repository } from 'typeorm';
import { TenantEntity } from './tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { NullableType } from '@mod/types/nullable.type';

@Injectable()
export class TenantService {
    constructor(
        @InjectRepository(TenantEntity)
        private readonly tenantRepository: Repository<TenantEntity>,
        private readonly sns: SnsPublisher
    ) {}

    async create(createTenantDto: CreateTenantDto): Promise<TenantEntity> {
        const { name, slug } = createTenantDto;

        let tenantSlug = slug;
        if (!tenantSlug) {
            tenantSlug = slugify(name, { lower: true, strict: true });
        }

        const existing = await this.tenantRepository.findOne({ where: { slug: tenantSlug } });
        if (existing) {
            throw new ConflictException('Tenant with this slug already exists');
        }

        const tenant = this.tenantRepository.create({
            ...createTenantDto,
            slug: tenantSlug,
            settings: this.getDefaultSettings()
        });
        const savedTenant = await this.tenantRepository.save(tenant);

        await this.sns.publish(
            {
                eventId: savedTenant.id,
                eventType: 'tenant.created',
                data: {
                    ...savedTenant,
                    ownerId: createTenantDto.ownerId
                } as unknown as any,
                timestamp: new Date().toISOString()
            },
            {
                topic: 'tenant-events',
                groupId: savedTenant.id,
                deduplicationId: savedTenant.id
            }
        );

        return savedTenant;
    }

    async findAll(): Promise<TenantEntity[]> {
        return await this.tenantRepository.find();
    }

    async findOne(id: string): Promise<NullableType<TenantEntity>> {
        return this.tenantRepository.findOne({ where: { id } });
    }

    async findOneOrFail(id: string): Promise<TenantEntity> {
        return this.tenantRepository.findOneOrFail({ where: { id } });
    }

    async update(id: string, updateTenantDto: UpdateTenantDto): Promise<TenantEntity> {
        await this.tenantRepository.update(id, updateTenantDto);
        return this.findOneOrFail(id);
    }

    async remove(id: string): Promise<DeleteResult> {
        return await this.tenantRepository.delete(id);
    }

    private getDefaultSettings() {
        return {
            theme: 'light',
            notifications: {
                email: true
            }
        };
    }
}
