import { Injectable, HttpStatus, HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FilesService } from '@mod/files/files.service';
import slugify from 'slugify';
import { TenantSettingService } from '@mod/tenant-setting/tenant-setting.service';
import { TenantEntity } from '../tenant.entity';
import { CreateTenantDto } from '../dto/tenant/create-tenant.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class AgnosticTenantService {
    constructor(
        @InjectRepository(TenantEntity)
        private readonly tenantRepository: Repository<TenantEntity>,
        private readonly filesService: FilesService,
        private readonly tenantSettingService: TenantSettingService,
        private readonly eventEmitter: EventEmitter2
    ) {}

    async create(createTenantDto: CreateTenantDto, file?: Express.Multer.File | Express.MulterS3.File): Promise<TenantEntity> {
        const { name, slug } = createTenantDto;

        let tenantSlug = slug;
        if (!tenantSlug) {
            tenantSlug = slugify(name, { lower: true, strict: true });
        }

        const existing = await this.tenantRepository.findOne({ where: { slug: tenantSlug } });
        if (existing) {
            throw new HttpException({ message: 'Tenant with this slug already exists', code: HttpStatus.CONFLICT }, HttpStatus.CONFLICT);
        }

        const tenant = this.tenantRepository.create({
            ...createTenantDto,
            slug: tenantSlug
        });

        if (file) {
            tenant.image = await this.filesService.uploadFile(file);
        }

        // Create default settings
        tenant.setting = await this.tenantSettingService.createDefault();

        const savedTenant = await this.tenantRepository.save(tenant);

        // Emit tenant.created event for side effects (Keto, Audit, SNS)
        this.eventEmitter.emit('tenant.created', {
            tenant: savedTenant,
            ownerId: createTenantDto.ownerId!
        });

        return savedTenant;
    }
}
