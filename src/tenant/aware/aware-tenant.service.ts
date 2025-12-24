import { Injectable, HttpStatus, HttpException } from '@nestjs/common';
import { DeleteResult, FindOptionsRelations, FindOptionsWhere } from 'typeorm';
import { NullableType } from '@mod/types/nullable.type';
import { FilesService } from '@mod/files/files.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KratosService } from '@mod/common/auth/kratos.service';
import { TenantStatusEnum, DomainVerificationStatusEnum } from '@mod/common/enums/tenant.enum';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { TenantEntity } from '../tenant.entity';
import { LockTenantDto } from '../dto/tenant/lock-tenant.dto';
import { UnlockTenantDto } from '../dto/tenant/unlock-tenant.dto';
import { UpdateTenantDto } from '../dto/tenant/update-tenant.dto';
import { ScheduleDeletionDto } from '../dto/schedule-deletion.dto';
import { CancelDeletionDto } from '../dto/cancel-deletion.dto';
import { TransferOwnershipDto } from '../dto/transfer-ownership.dto';
import { AuditService } from '@mod/common/audit/audit.service';
import { AuditAction } from '@mod/common/audit/audit-action.enum';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { SubdomainService } from '../dns/subdomain.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TENANT_UNLOCK_QUEUE, TenantUnlockJobData } from '@mod/common/bullmq/queues/tenant-unlock.queue';
import { ApiKeyStatusEnum } from '@mod/common/enums/api-key.enum';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { CurrentUserType } from '@mod/common/auth/current-user.decorator';

@Injectable()
export class AwareTenantService {
    constructor(
        @InjectTenantAwareRepository(TenantEntity)
        private readonly tenantRepository: TenantAwareRepository<TenantEntity>,
        private readonly filesService: FilesService,
        private readonly eventEmitter: EventEmitter2,
        private readonly kratosService: KratosService,
        private readonly dnsVerificationService: DnsVerificationService,
        private readonly subdomainService: SubdomainService,
        @InjectQueue(TENANT_UNLOCK_QUEUE)
        private readonly unlockQueue: Queue<TenantUnlockJobData>,
        private readonly auditService: AuditService
    ) {}

    async findAll(): Promise<TenantEntity[]> {
        return await this.tenantRepository.findTenantContext();
    }

    async findOne(field: FindOptionsWhere<TenantEntity>, relations?: FindOptionsRelations<TenantEntity>): Promise<NullableType<TenantEntity>> {
        return this.tenantRepository.findOneTenantContext(field, relations);
    }

    async getTenantProfileStatistics(tenantId: string) {
        const query = this.tenantRepository.manager
            .createQueryBuilder()
            .select((subQuery) => {
                return subQuery.select('count(*)', 'count').from('team_members', 'tm').where('tm.tenantId = :tenantId', { tenantId });
            }, 'memberCount')
            .addSelect((subQuery) => {
                return subQuery
                    .select('count(*)', 'count')
                    .from('invitations', 'i')
                    .where('i.tenantId = :tenantId', { tenantId })
                    .andWhere('i.status = :invStatus', { invStatus: InvitationStatusEnum.PENDING });
            }, 'pendingInvitationCount')
            .addSelect((subQuery) => {
                return subQuery
                    .select('count(*)', 'count')
                    .from('api_keys', 'ak')
                    .where('ak.tenantId = :tenantId', { tenantId })
                    .andWhere('ak.status = :akStatus', { akStatus: ApiKeyStatusEnum.ACTIVE });
            }, 'activeApiKeyCount');

        const result = await query.getRawOne();
        return {
            memberCount: parseInt(result.memberCount || '0', 10),
            pendingInvitationCount: parseInt(result.pendingInvitationCount || '0', 10),
            activeApiKeyCount: parseInt(result.activeApiKeyCount || '0', 10)
        };
    }

    async findOneOrFail(field: FindOptionsWhere<TenantEntity>): Promise<TenantEntity> {
        return this.tenantRepository.findOneOrFailTenantContext(field);
    }

    async getProfile(id: string): Promise<TenantEntity & { memberCount: number; pendingInvitationCount: number; activeApiKeyCount: number }> {
        const tenant = await this.findOneOrFail({ id });
        const stats = await this.getTenantProfileStatistics(id);

        return Object.assign(tenant, stats);
    }

    async update(
        id: string,
        updateTenantDto: UpdateTenantDto,
        user: CurrentUserType,
        file?: Express.Multer.File | Express.MulterS3.File,
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
            userId: user.id,
            userEmail: user.email,
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

    async transferOwnership(id: string, dto: TransferOwnershipDto, user: CurrentUserType, ipAddress?: string): Promise<void> {
        // Task 73: Password verification
        const passwordValid = await this.kratosService.verifyPassword(user.identityId, dto.password);
        if (!passwordValid) {
            throw new HttpException({ message: 'Invalid password', code: HttpStatus.UNAUTHORIZED }, HttpStatus.UNAUTHORIZED);
        }

        const tenant = await this.findOneOrFail({ id });

        // Task 75: Audit logging
        await this.auditService.log({
            tenantId: id,
            userId: user.id,
            action: AuditAction.OWNERSHIP_TRANSFERRED,
            description: `Transferred ownership of tenant ${id} to ${dto.newOwnerId}`,
            metadata: {
                tenantId: id,
                oldOwnerId: user.id,
                newOwnerId: dto.newOwnerId
            },
            ipAddress,
            userAgent: 'system' // Controller doesn't pass user agent yet, can be updated later
        });

        // Emit event for Keto relation updates and notifications
        this.eventEmitter.emit('ownership.transferred', {
            tenantId: id,
            oldOwnerId: user.id,
            newOwnerId: dto.newOwnerId,
            tenantName: tenant.name,
            ipAddress
        });
    }

    /**
     * Schedule tenant deletion with 30-day grace period
     * Requires password verification for security
     */
    async scheduleDeletion(
        id: string,
        dto: ScheduleDeletionDto,
        user: CurrentUserType,
        ipAddress?: string
    ): Promise<{ scheduledAt: Date; executionDate: Date }> {
        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(user.identityId, dto.password);
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
            userId: user.id,
            userEmail: user.email,
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
    async cancelDeletion(id: string, dto: CancelDeletionDto, user: CurrentUserType, ipAddress?: string): Promise<void> {
        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(user.identityId, dto.password);
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
            userId: user.id,
            userEmail: user.email,
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

    /**
     * Lock a tenant account
     * Requires password verification for security
     */
    async lock(id: string, dto: LockTenantDto, userId: string, identityId: string, ipAddress?: string): Promise<TenantEntity> {
        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(identityId, dto.password);
        if (!passwordValid) {
            throw new HttpException({ message: 'Invalid password', code: HttpStatus.UNAUTHORIZED }, HttpStatus.UNAUTHORIZED);
        }

        const tenant = await this.findOneOrFail({ id });

        // Check if already locked
        if (tenant.status === TenantStatusEnum.LOCKED) {
            throw new HttpException({ message: 'Tenant is already locked', code: HttpStatus.CONFLICT }, HttpStatus.CONFLICT);
        }

        // Update tenant status
        tenant.status = TenantStatusEnum.LOCKED;
        tenant.lockedAt = new Date();
        tenant.lockUntil = dto.lockUntil;
        tenant.lockReason = dto.reason;

        await this.tenantRepository.save(tenant);

        // Schedule auto-unlock job if lockUntil is set
        if (dto.lockUntil) {
            const delay = new Date(dto.lockUntil).getTime() - Date.now();
            if (delay > 0) {
                await this.unlockQueue.add(
                    'auto-unlock',
                    {
                        tenantId: id,
                        lockUntil: new Date(dto.lockUntil).toISOString()
                    },
                    {
                        delay,
                        jobId: `unlock-${id}` // Prevent multiple parallel unlock jobs for same tenant
                    }
                );
            }
        }

        // Emit event for side effects
        this.eventEmitter.emit('tenant.locked', {
            tenant,
            userId,
            lockedAt: tenant.lockedAt,
            lockUntil: tenant.lockUntil,
            reason: tenant.lockReason,
            ipAddress
        });

        return tenant;
    }

    /**
     * Unlock a tenant account
     * Requires password verification for security
     */
    async unlock(id: string, dto: UnlockTenantDto, userId: string, identityId: string, ipAddress?: string): Promise<TenantEntity> {
        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(identityId, dto.password);
        if (!passwordValid) {
            throw new HttpException({ message: 'Invalid password', code: HttpStatus.UNAUTHORIZED }, HttpStatus.UNAUTHORIZED);
        }

        const tenant = await this.findOneOrFail({ id });

        // Check if locked
        if (tenant.status !== TenantStatusEnum.LOCKED) {
            throw new HttpException({ message: 'Tenant is not locked', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }

        // Restore tenant to active status
        tenant.status = TenantStatusEnum.ACTIVE;
        tenant.lockedAt = undefined;
        tenant.lockUntil = undefined;
        tenant.lockReason = undefined;

        await this.tenantRepository.save(tenant);

        // Emit event for side effects
        this.eventEmitter.emit('tenant.unlocked', {
            tenant,
            userId,
            ipAddress
        });

        return tenant;
    }

    /**
     * Automatically unlock a tenant account
     * This is called by the system (e.g., Bull job)
     */
    async autoUnlock(id: string): Promise<void> {
        const tenant = await this.tenantRepository.findOneOrFailTenantContext({ id });

        if (tenant.status !== TenantStatusEnum.LOCKED) {
            return;
        }

        // Restore tenant to active status
        tenant.status = TenantStatusEnum.ACTIVE;
        tenant.lockedAt = undefined;
        tenant.lockUntil = undefined;
        tenant.lockReason = undefined;

        await this.tenantRepository.save(tenant);

        // Emit event for side effects
        this.eventEmitter.emit('tenant.unlocked', {
            tenant,
            userId: 'system',
            reason: 'auto-unlock'
        });
    }
}
