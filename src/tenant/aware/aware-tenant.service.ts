import { Injectable, HttpStatus, HttpException } from '@nestjs/common';
import { DeleteResult, FindOptionsRelations, FindOptionsWhere } from 'typeorm';
import { NullableType } from '@mod/types/nullable.type';
import { FilesService } from '@mod/files/files.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KratosService } from '@mod/common/auth/kratos.service';
import { TenantStatusEnum, DomainVerificationStatusEnum } from '@mod/common/enums/tenant.enum';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { TenantEntity } from '../tenant.entity';
import { UpdateTenantDto } from '../dto/tenant/update-tenant.dto';
import { ScheduleDeletionDto } from '../dto/schedule-deletion.dto';
import { CancelDeletionDto } from '../dto/cancel-deletion.dto';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { SubdomainService } from '../dns/subdomain.service';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';

@Injectable()
export class AwareTenantService {
    constructor(
        @InjectTenantAwareRepository(TenantEntity)
        private readonly tenantRepository: TenantAwareRepository<TenantEntity>,
        private readonly filesService: FilesService,
        private readonly eventEmitter: EventEmitter2,
        private readonly kratosService: KratosService,
        private readonly dnsVerificationService: DnsVerificationService,
        private readonly subdomainService: SubdomainService
    ) {}

    async findAll(): Promise<TenantEntity[]> {
        return await this.tenantRepository.findTenantContext();
    }

    async findOne(field: FindOptionsWhere<TenantEntity>, relations?: FindOptionsRelations<TenantEntity>): Promise<NullableType<TenantEntity>> {
        return this.tenantRepository.findOneTenantContext(field, relations);
    }

    async findOneOrFail(field: FindOptionsWhere<TenantEntity>): Promise<TenantEntity> {
        return this.tenantRepository.findOneOrFailTenantContext(field);
    }

    async update(
        id: string,
        updateTenantDto: UpdateTenantDto,
        file?: Express.Multer.File | Express.MulterS3.File,
        userId?: string,
        userEmail?: string,
        ipAddress?: string
    ): Promise<TenantEntity> {
        const existingTenant = await this.findOneOrFail({ id });
        // Create a shallow copy for "old" state reference
        const oldTenant = { ...existingTenant } as TenantEntity;

        const partialUpdate: Partial<TenantEntity> = { ...updateTenantDto };

        if (file) {
            existingTenant.image = await this.filesService.uploadFile(file);
        }

        if (updateTenantDto.customDomain && updateTenantDto.customDomain !== existingTenant.customDomain) {
            partialUpdate.domainVerificationToken = `pulse-verification-${randomStringGenerator()}`;
            partialUpdate.domainVerificationStatus = DomainVerificationStatusEnum.PENDING;
        }

        if (updateTenantDto.slug && updateTenantDto.slug !== existingTenant.slug) {
            this.subdomainService.validateSubdomain(updateTenantDto.slug);
            const isAvailable = await this.subdomainService.isSubdomainAvailable(updateTenantDto.slug);
            if (!isAvailable) {
                throw new HttpException('Subdomain is already taken', HttpStatus.CONFLICT);
            }
            // Reserve old slug for 7 days
            await this.subdomainService.reserveSubdomain(existingTenant.slug, id, 7);
        }

        await this.tenantRepository.save({
            ...existingTenant,
            ...partialUpdate
        });
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

    async verifyCustomDomain(id: string): Promise<TenantEntity> {
        const tenant = await this.findOneOrFail({ id });

        if (!tenant.customDomain || !tenant.domainVerificationToken) {
            throw new HttpException('No custom domain configuration found to verify', HttpStatus.BAD_REQUEST);
        }

        const isVerified = await this.dnsVerificationService.verifyTxtRecord(tenant.customDomain, tenant.domainVerificationToken);

        if (isVerified) {
            tenant.domainVerificationStatus = DomainVerificationStatusEnum.VERIFIED;
            await this.tenantRepository.save(tenant);
            this.eventEmitter.emit('tenant.domain.verified', { tenant });
        } else {
            tenant.domainVerificationStatus = DomainVerificationStatusEnum.FAILED;
            await this.tenantRepository.save(tenant);
            throw new HttpException('DNS verification failed. Please check your TXT records.', HttpStatus.BAD_REQUEST);
        }

        return tenant;
    }

    async getDomainStatus(id: string): Promise<{
        customDomain?: string;
        domainVerificationStatus?: DomainVerificationStatusEnum;
        domainVerificationToken?: string;
    }> {
        const tenant = await this.findOneOrFail({ id });
        return {
            customDomain: tenant.customDomain,
            domainVerificationStatus: tenant.domainVerificationStatus,
            domainVerificationToken: tenant.domainVerificationToken
        };
    }

    async checkSubdomainAvailability(subdomain: string): Promise<{ available: boolean }> {
        const available = await this.subdomainService.isSubdomainAvailable(subdomain);
        return { available };
    }

    async transferOwnership(id: string, newOwnerId: string, currentOwnerId: string): Promise<void> {
        const tenant = await this.findOneOrFail({ id });

        // Emit event for Keto relation updates
        this.eventEmitter.emit('ownership.transferred', {
            tenantId: id,
            oldOwnerId: currentOwnerId,
            newOwnerId,
            tenantName: tenant.name
        });
    }

    /**
     * Schedule tenant deletion with 30-day grace period
     * Requires password verification for security
     */
    async scheduleDeletion(
        id: string,
        dto: ScheduleDeletionDto,
        userId: string,
        identityId: string,
        ipAddress?: string
    ): Promise<{ scheduledAt: Date; executionDate: Date }> {
        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(identityId, dto.password);
        if (!passwordValid) {
            throw new HttpException({ message: 'Invalid password', code: HttpStatus.UNAUTHORIZED }, HttpStatus.UNAUTHORIZED);
        }

        const tenant = await this.findOneOrFail({ id });

        // Check if deletion is already scheduled
        if (tenant.status === TenantStatusEnum.DELETION_SCHEDULED) {
            throw new HttpException({ message: 'Deletion is already scheduled for this tenant', code: HttpStatus.CONFLICT }, HttpStatus.CONFLICT);
        }

        // Calculate deletion date (30 days from now)
        const scheduledAt = new Date();
        const executionDate = new Date();
        executionDate.setDate(executionDate.getDate() + 30);

        // Update tenant status
        tenant.status = TenantStatusEnum.DELETION_SCHEDULED;
        tenant.deletionScheduledAt = scheduledAt;
        tenant.deletionReason = dto.reason;

        await this.tenantRepository.save(tenant);

        // Emit event for side effects (Audit, SNS, Notification, Job Queue)
        this.eventEmitter.emit('tenant.deletion.scheduled', {
            tenant,
            userId,
            scheduledAt,
            executionDate,
            reason: dto.reason,
            ipAddress
        });

        return { scheduledAt, executionDate };
    }

    /**
     * Cancel a scheduled tenant deletion
     * Requires password verification for security
     */
    async cancelDeletion(id: string, dto: CancelDeletionDto, userId: string, identityId: string, ipAddress?: string): Promise<void> {
        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(identityId, dto.password);
        if (!passwordValid) {
            throw new HttpException({ message: 'Invalid password', code: HttpStatus.UNAUTHORIZED }, HttpStatus.UNAUTHORIZED);
        }

        const tenant = await this.findOneOrFail({ id });

        // Check if deletion is scheduled
        if (tenant.status !== TenantStatusEnum.DELETION_SCHEDULED) {
            throw new HttpException({ message: 'No deletion is scheduled for this tenant', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }

        // Restore tenant to active status
        tenant.status = TenantStatusEnum.ACTIVE;
        tenant.deletionScheduledAt = undefined;
        tenant.deletionReason = undefined;

        await this.tenantRepository.save(tenant);

        // Emit event for side effects (Audit, SNS, Notification)
        this.eventEmitter.emit('tenant.deletion.cancelled', {
            tenant,
            userId,
            ipAddress
        });
    }

    /**
     * Execute tenant deletion (hard delete)
     * This should only be called by the scheduled job after 30 days
     */
    async executeDeletion(id: string): Promise<void> {
        const tenant = await this.findOneOrFail({ id });

        // Verify tenant is scheduled for deletion
        if (tenant.status !== TenantStatusEnum.DELETION_SCHEDULED) {
            throw new HttpException({ message: 'Tenant is not scheduled for deletion', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }

        // Verify 30 days have passed
        if (tenant.deletionScheduledAt) {
            const now = new Date();
            const scheduledDate = new Date(tenant.deletionScheduledAt);
            const daysPassed = Math.floor((now.getTime() - scheduledDate.getTime()) / (1000 * 60 * 60 * 24));

            if (daysPassed < 30) {
                throw new HttpException(
                    { message: 'Cannot delete tenant before 30-day grace period has passed', code: HttpStatus.BAD_REQUEST },
                    HttpStatus.BAD_REQUEST
                );
            }
        }

        // Emit event BEFORE deletion for side effects (Audit, SNS, Cleanup)
        this.eventEmitter.emit('tenant.deleted', {
            tenant,
            deletedAt: new Date()
        });

        // Hard delete tenant
        await this.tenantRepository.delete(id);
    }

    async remove(id: string): Promise<DeleteResult> {
        return await this.tenantRepository.delete(id);
    }
}
