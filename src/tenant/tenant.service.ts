import { Injectable, HttpStatus, HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteResult, FindOptionsRelations, FindOptionsWhere, Repository } from 'typeorm';
import { TenantEntity } from './tenant.entity';
import { CreateTenantDto } from './dto/tenant/create-tenant.dto';
import { UpdateTenantDto } from './dto/tenant/update-tenant.dto';
import { TenantSettingsDto } from './dto/settings/tenant-settings.dto';
import { NullableType } from '@mod/types/nullable.type';
import { FilesService } from '@mod/files/files.service';
import { KetoService } from '@mod/common/auth/keto.service';
import slugify from 'slugify';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class TenantService {
    constructor(
        @InjectRepository(TenantEntity)
        private readonly tenantRepository: Repository<TenantEntity>,
        private readonly filesService: FilesService,
        private readonly ketoService: KetoService,
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
            slug: tenantSlug,
            settings: this.getDefaultSettings()
        });

        if (file) {
            tenant.image = await this.filesService.uploadFile(file);
        }

        const savedTenant = await this.tenantRepository.save(tenant);

        // Emit tenant.created event for side effects (Keto, Audit, SNS)
        this.eventEmitter.emit('tenant.created', {
            tenant: savedTenant,
            ownerId: createTenantDto.ownerId!
        });

        return savedTenant;
    }

    async findAll(): Promise<TenantEntity[]> {
        return await this.tenantRepository.find();
    }

    async findOne(field: FindOptionsWhere<TenantEntity>, relations?: FindOptionsRelations<TenantEntity>): Promise<NullableType<TenantEntity>> {
        return this.tenantRepository.findOne({
            where: field,
            relations
        });
    }

    async findOneOrFail(field: FindOptionsWhere<TenantEntity>, relations?: FindOptionsRelations<TenantEntity>): Promise<TenantEntity> {
        return this.tenantRepository.findOneOrFail({ where: field, relations });
    }

    async update(
        id: string,
        updateTenantDto: UpdateTenantDto,
        file?: Express.Multer.File | Express.MulterS3.File,
        userId?: string,
        userEmail?: string,
        ipAddress?: string
    ): Promise<TenantEntity> {
        // Verify permission if userId is provided
        if (userId) {
            const allowed = await this.ketoService.check(KetoNamespace.TENANT, id, KetoPermission.UPDATE, userId);
            if (!allowed) {
                throw new HttpException(
                    { message: 'You do not have permission to update this tenant', code: HttpStatus.FORBIDDEN },
                    HttpStatus.FORBIDDEN
                );
            }
        }

        const existingTenant = await this.findOneOrFail({ id });
        // Create a shallow copy for "old" state reference
        const oldTenant = { ...existingTenant } as TenantEntity;

        if (file) {
            existingTenant.image = await this.filesService.uploadFile(file);
        }

        await this.tenantRepository.update(id, updateTenantDto);
        const updatedTenant = await this.findOneOrFail({ id });

        // Emit tenant.updated event for side effects (Audit, SNS)
        this.eventEmitter.emit('tenant.updated', {
            tenant: updatedTenant,
            oldTenant,
            changes: updateTenantDto,
            userId,
            userEmail,
            ipAddress
        });

        return updatedTenant;
    }

    async transferOwnership(tenantId: string, newOwnerId: string, currentOwnerId: string): Promise<void> {
        const tenant = await this.findOneOrFail({ id: tenantId });

        // Verify current owner has permission
        const allowed = await this.ketoService.check(KetoNamespace.TENANT, tenantId, KetoPermission.UPDATE, currentOwnerId);
        if (!allowed) {
            throw new HttpException({ message: 'Only the owner can transfer ownership', code: HttpStatus.FORBIDDEN }, HttpStatus.FORBIDDEN);
        }

        // Emit event for Keto relation updates
        this.eventEmitter.emit('ownership.transferred', {
            tenantId,
            oldOwnerId: currentOwnerId,
            newOwnerId,
            tenantName: tenant.name
        });
    }

    async getSettings(id: string): Promise<TenantSettingsDto> {
        const tenant = await this.findOneOrFail({ id });
        return tenant.settings as TenantSettingsDto;
    }

    async updateSettings(id: string, settingsDto: TenantSettingsDto, userId: string, ipAddress?: string): Promise<TenantSettingsDto> {
        // Verify permission
        const allowed = await this.ketoService.check(KetoNamespace.TENANT, id, KetoPermission.UPDATE, userId);
        if (!allowed) {
            throw new HttpException(
                { message: 'You do not have permission to update settings for this tenant', code: HttpStatus.FORBIDDEN },
                HttpStatus.FORBIDDEN
            );
        }

        const tenant = await this.findOneOrFail({ id });
        const oldSettings = tenant.settings;

        const newSettings = {
            ...tenant.settings,
            branding: { ...(tenant.settings.branding || {}), ...settingsDto.branding },
            notifications: { ...(tenant.settings.notifications || {}), ...settingsDto.notifications },
            general: { ...(tenant.settings.general || {}), ...settingsDto.general }
        };

        tenant.settings = newSettings;

        await this.tenantRepository.save(tenant);

        // Reuse tenant.updated event but maybe we want a specific one.
        // For now, let's treat it as a tenant update.
        // Or create a specific listener. The task implies audit log viewing, so capturing this as an action is good.

        // Let's use the existing tenant.updated event but pass the changes in a way the listener understands,
        // or just rely on the fact that we changed 'settings'.

        this.eventEmitter.emit('tenant.updated', {
            tenant,
            oldTenant: { ...tenant, settings: oldSettings },
            changes: { settings: newSettings },
            userId,
            ipAddress
        });

        return tenant.settings as TenantSettingsDto;
    }

    async remove(id: string): Promise<DeleteResult> {
        return await this.tenantRepository.delete(id);
    }

    private getDefaultSettings() {
        return {
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
                currency: 'USD',
                locale: 'en-US'
            }
        };
    }
}
