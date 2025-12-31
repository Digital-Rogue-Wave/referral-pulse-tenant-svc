import { Injectable, HttpStatus, HttpException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FilesService } from '@mod/files/files.service';
import slugify from 'slugify';
import { AgnosticTenantSettingService } from '@mod/tenant-setting/agnostic/agnostic-tenant-setting.service';
import { TenantEntity } from '../tenant.entity';
import { CreateTenantDto } from '../dto/tenant/create-tenant.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubdomainService } from '../../dns/subdomain.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { Utils } from '@mod/common/utils/utils';
import { KetoRelationTupleDto } from '@mod/common/auth/dto/keto-relation-tuple.dto';
import { KetoNamespace, KetoRelation } from '@mod/common/auth/keto.constants';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { NullableType } from '@mod/types/nullable.type';
import { ConfigService } from '@nestjs/config';
import type { AllConfigType } from '@mod/config/config.type';

@Injectable()
export class AgnosticTenantService {
    private readonly logger = new Logger(AgnosticTenantService.name);
    constructor(
        @InjectRepository(TenantEntity)
        private readonly tenantRepository: Repository<TenantEntity>,
        private readonly filesService: FilesService,
        private readonly tenantSettingService: AgnosticTenantSettingService,
        private readonly eventEmitter: EventEmitter2,
        private readonly subdomainService: SubdomainService,
        private readonly ketoService: KetoService,
        private readonly configService: ConfigService<AllConfigType>
    ) {}

    async create(createTenantDto: CreateTenantDto, file?: Express.Multer.File | Express.MulterS3.File): Promise<TenantEntity> {
        const { name, slug } = createTenantDto;

        let tenantSlug = slug;
        if (!tenantSlug) {
            tenantSlug = slugify(name, { lower: true, strict: true });
        }

        // Validate subdomain format and reserved list
        this.subdomainService.validateSubdomain(tenantSlug);

        // Check availability (including reserved subdomains)
        const isAvailable = await this.subdomainService.isSubdomainAvailable(tenantSlug);
        if (!isAvailable) {
            throw new HttpException({ message: 'Subdomain is already taken or reserved', code: HttpStatus.CONFLICT }, HttpStatus.CONFLICT);
        }

        // 1. Create and save the tenant entity
        const now = new Date();
        const appConfig = this.configService.get('appConfig', { infer: true });
        const trialDurationDays = appConfig?.trialDurationDays ?? 14;
        const trialStartedAt = now;
        const trialEndsAt = new Date(now.getTime() + trialDurationDays * 24 * 60 * 60 * 1000);

        const tenant = this.tenantRepository.create({
            ...createTenantDto,
            slug: tenantSlug,
            trialStartedAt,
            trialEndsAt
        });

        if (file) {
            tenant.image = await this.filesService.uploadFile(file);
        }

        const savedTenant = await this.tenantRepository.save(tenant);

        // 2. Create default settings linked to the saved tenant
        savedTenant.setting = await this.tenantSettingService.createDefault(savedTenant);

        const ownerId = createTenantDto.ownerId!;

        // 3. Create Keto relations for the owner (Permissions)
        const memberTuple = await Utils.validateDtoOrFail(KetoRelationTupleDto, {
            namespace: KetoNamespace.TENANT,
            object: savedTenant.id,
            relation: KetoRelation.MEMBER,
            subject_id: ownerId
        });
        await this.ketoService.createTuple(memberTuple);

        const billingTuple = await Utils.validateDtoOrFail(KetoRelationTupleDto, {
            namespace: KetoNamespace.TENANT,
            object: savedTenant.id,
            relation: KetoRelation.MANAGE_BILLING,
            subject_id: ownerId
        });
        await this.ketoService.createTuple(billingTuple);

        // Envent emitter logging
        this.logger.log(`tenant.created event received`, {
            tenantId: savedTenant.id,
            ownerId: ownerId
        });
        // 4. Emit tenant.created event for side effects (Audit, SNS)
        this.eventEmitter.emit('tenant.created', {
            tenant: savedTenant,
            ownerId: ownerId
        });

        return savedTenant;
    }

    async findOne(id: string): Promise<NullableType<TenantEntity>> {
        return await this.tenantRepository.findOne({ where: { id } });
    }

    async suspend(id: string, reason?: string): Promise<TenantEntity> {
        const tenant = await this.findOne(id);
        if (!tenant) {
            throw new HttpException({ message: 'Tenant not found', code: HttpStatus.NOT_FOUND }, HttpStatus.NOT_FOUND);
        }

        tenant.status = TenantStatusEnum.SUSPENDED;
        const updatedTenant = await this.tenantRepository.save(tenant);

        this.eventEmitter.emit('tenant.suspended', {
            tenantId: id,
            reason
        });

        return updatedTenant;
    }

    async unsuspend(id: string): Promise<TenantEntity> {
        const tenant = await this.tenantRepository.findOne({ where: { id } });
        if (!tenant) {
            throw new HttpException({ message: 'Tenant not found', code: HttpStatus.NOT_FOUND }, HttpStatus.NOT_FOUND);
        }

        tenant.status = TenantStatusEnum.ACTIVE;
        const updatedTenant = await this.tenantRepository.save(tenant);

        this.eventEmitter.emit('tenant.unsuspended', {
            tenantId: id
        });

        return updatedTenant;
    }
}
