import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import slugify from '@sindresorhus/slugify';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';

import type { Tenant, Prisma } from '@prisma-gen/generated/client';
import type { AllConfigType } from '@config/config.type';
import type { NullableType, TenantUnlockJobData, IAuthenticatedUser } from '@app/types';
import type { TenantProps, TenantProfileProps } from '@domains/tenant';
import { TENANT_UNLOCK_QUEUE } from '@app/types';

import { DatabaseService } from '@app/database/database.service';
import { BullJobsService } from '@common/bulljobs';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { KetoService } from '@common/auth/keto.service';
import { KratosService } from '@common/auth/kratos.service';
import { KetoNamespace, KetoRelation, KetoResource } from '@common/auth/keto.constants';

import { SubdomainService } from '../dns/subdomain.service';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { FilesService } from '../files/files.service';
import {
    TenantCreatedEvent,
    TenantUpdatedEvent,
    TenantDeletedEvent,
    TenantSuspendedEvent,
    TenantUnsuspendedEvent,
    TenantLockedEvent,
    TenantUnlockedEvent,
    TenantDeletionScheduledEvent,
    TenantDeletionCancelledEvent,
    TenantOwnershipTransferredEvent,
    TenantDomainVerifiedEvent,
    TenantEvents,
} from '@domains/tenant/events/tenant.events';
import { TenantStatus, DomainVerificationStatus } from '@domains/tenant/tenant.types';
import { tenantResponseMapper } from '@domains/tenant/mappers/tenant-response.mapper';
import {
    TenantResponse,
    TenantProfileResponse,
    DomainStatusResponse,
    SubdomainAvailabilityResponse,
    DeletionScheduledResponse,
    CreateTenantDto,
    UpdateTenantDto,
    LockTenantDto,
    UnlockTenantDto,
    ScheduleDeletionDto,
    CancelDeletionDto,
    TransferOwnershipDto,
} from '@domains/tenant';

@Injectable()
export class TenantService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly tenantContext: TenantContextService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly ketoService: KetoService,
        private readonly kratosService: KratosService,
        private readonly subdomainService: SubdomainService,
        private readonly dnsVerificationService: DnsVerificationService,
        private readonly filesService: FilesService,
        private readonly bullJobsService: BullJobsService,
    ) {
        this.logger.setContext(TenantService.name);
    }

    // ============================================================================
    // ADMIN/AGNOSTIC OPERATIONS (no tenant context required)
    // ============================================================================

    /**
     * Create a new tenant
     * This is an admin operation that doesn't require tenant context
     */
    async create(dto: CreateTenantDto, file?: Express.Multer.File | Express.MulterS3.File): Promise<TenantResponse> {
        const { name, slug, ownerId } = dto;

        let tenantSlug = slug;
        if (!tenantSlug) {
            tenantSlug = slugify(name);
        }

        // Validate subdomain format and reserved list
        this.subdomainService.validateSubdomain(tenantSlug);

        // Check availability
        const isAvailable = await this.subdomainService.isSubdomainAvailable(tenantSlug);
        if (!isAvailable) {
            throw new HttpException(
                {
                    message: 'Subdomain is already taken or reserved',
                    errorCode: 'SUBDOMAIN_UNAVAILABLE',
                },
                HttpStatus.CONFLICT,
            );
        }

        // Calculate trial dates
        const now = new Date();
        const appConfig = this.configService.get('app', { infer: true });
        const trialDurationDays = appConfig?.trialDurationDays ?? 14;
        const trialEndsAt = new Date(now.getTime() + trialDurationDays * 24 * 60 * 60 * 1000);

        // Handle file upload
        let imageId: string | undefined;
        if (file) {
            const uploadedFile = await this.filesService.uploadFile(file);
            imageId = uploadedFile.id;
        }

        // Create tenant in transaction
        const tenant = await this.prisma.$transaction(async (tx) => {
            const created = await tx.tenant.create({
                data: {
                    name,
                    slug: tenantSlug!,
                    imageId,
                    status: TenantStatus.ACTIVE,
                    trialStartedAt: now,
                    trialEndsAt,
                },
            });

            // Create default tenant settings
            await tx.tenantSetting.create({
                data: {
                    tenantId: created.id,
                    branding: {},
                    notifications: {},
                    general: {},
                },
            });

            // Grant owner CRUD on all tenant resources
            const ownerResources = [
                KetoResource.MEMBER,
                KetoResource.INVITATION,
                KetoResource.API_KEY,
                KetoResource.BILLING,
                KetoResource.PLANS,
                KetoResource.SETTINGS,
            ];
            const ownerActions = [KetoRelation.CREATE, KetoRelation.READ, KetoRelation.UPDATE, KetoRelation.DELETE];

            for (const resource of ownerResources) {
                for (const action of ownerActions) {
                    await this.ketoService.createTuple({
                        namespace: KetoNamespace.TENANT,
                        object: resource,
                        relation: action,
                        subject_id: ownerId!,
                    });
                }
            }

            // Emit event after commit
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.CREATED,
                new TenantCreatedEvent(
                    created.id,
                    created.id,
                    created.name,
                    created.slug,
                    ownerId!,
                    now,
                    trialEndsAt,
                    ownerId,
                ),
            );

            return created;
        });

        this.logger.log(`Tenant created: ${tenant.id}`, {
            tenantId: tenant.id,
            slug: tenant.slug,
            ownerId,
        });

        return tenantResponseMapper.toResponse(tenant as TenantProps);
    }

    /**
     * Find a tenant by ID (admin operation)
     */
    async findOneById(id: string): Promise<NullableType<Tenant>> {
        return this.prisma.tenant.findUnique({
            where: { id, deletedAt: null },
        });
    }

    /**
     * Find a tenant by slug (admin operation)
     */
    async findOneBySlug(slug: string): Promise<NullableType<Tenant>> {
        return this.prisma.tenant.findUnique({
            where: { slug, deletedAt: null },
        });
    }

    /**
     * Suspend a tenant (admin operation)
     */
    async suspend(id: string, reason?: string, userId?: string): Promise<TenantResponse> {
        const tenant = await this.findOneById(id);
        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        const now = new Date();
        const updated = await this.prisma.tenant.update({
            where: { id },
            data: {
                status: TenantStatus.SUSPENDED,
                suspendedAt: now,
            },
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.SUSPENDED,
            new TenantSuspendedEvent(id, id, reason, now, userId),
        );

        this.logger.log(`Tenant suspended: ${id}`, { tenantId: id, reason });

        return tenantResponseMapper.toResponse(updated as TenantProps);
    }

    /**
     * Unsuspend a tenant (admin operation)
     */
    async unsuspend(id: string, userId?: string): Promise<TenantResponse> {
        const tenant = await this.findOneById(id);
        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        const now = new Date();
        const updated = await this.prisma.tenant.update({
            where: { id },
            data: {
                status: TenantStatus.ACTIVE,
                suspendedAt: null,
            },
        });

        this.txEventEmitter.emitAfterCommit(TenantEvents.UNSUSPENDED, new TenantUnsuspendedEvent(id, id, now, userId));

        this.logger.log(`Tenant unsuspended: ${id}`, { tenantId: id });

        return tenantResponseMapper.toResponse(updated as TenantProps);
    }

    // ============================================================================
    // TENANT-AWARE OPERATIONS (require tenant context)
    // ============================================================================

    /**
     * Get current tenant profile with statistics
     */
    async getProfile(): Promise<TenantProfileResponse> {
        const tenantId = this.tenantContext.getTenantId()!;

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
        });

        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        const stats = await this.getTenantStatistics(tenantId);

        const profileProps: TenantProfileProps = {
            ...(tenant as TenantProps),
            ...stats,
        };

        return tenantResponseMapper.toProfileResponse(profileProps);
    }

    /**
     * Get tenant statistics
     */
    private async getTenantStatistics(tenantId: string) {
        const [memberCount, pendingInvitationCount, activeApiKeyCount] = await Promise.all([
            this.prisma.teamMember.count({
                where: { tenantId, deletedAt: null },
            }),
            this.prisma.invitation.count({
                where: { tenantId, status: 'pending', deletedAt: null },
            }),
            this.prisma.apiKey.count({
                where: { tenantId, status: 'active', deletedAt: null },
            }),
        ]);

        return { memberCount, pendingInvitationCount, activeApiKeyCount };
    }

    /**
     * Update current tenant
     */
    async update(
        dto: UpdateTenantDto,
        user: IAuthenticatedUser,
        file?: Express.Multer.File | Express.MulterS3.File,
    ): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;

        const existing = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
        });

        if (!existing) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const updateData: Prisma.TenantUncheckedUpdateInput = {};

        // Handle name update
        if (dto.name && dto.name !== existing.name) {
            changes.name = { from: existing.name, to: dto.name };
            updateData.name = dto.name;
        }

        // Handle slug update
        if (dto.slug && dto.slug !== existing.slug) {
            this.subdomainService.validateSubdomain(dto.slug);
            const isAvailable = await this.subdomainService.isSubdomainAvailable(dto.slug);
            if (!isAvailable) {
                throw new HttpException(
                    {
                        message: 'Subdomain is already taken',
                        errorCode: 'SUBDOMAIN_TAKEN',
                    },
                    HttpStatus.CONFLICT,
                );
            }
            // Reserve old slug for 7 days
            await this.subdomainService.reserveSubdomain(existing.slug, tenantId, 7);
            changes.slug = { from: existing.slug, to: dto.slug };
            updateData.slug = dto.slug;
        }

        // Handle custom domain update
        if (dto.customDomain && dto.customDomain !== existing.customDomain) {
            changes.customDomain = {
                from: existing.customDomain,
                to: dto.customDomain,
            };
            updateData.customDomain = dto.customDomain;
            updateData.domainVerificationToken = `pulse-verification-${randomStringGenerator()}`;
            updateData.domainVerificationStatus = DomainVerificationStatus.PENDING;
        }

        // Handle file upload
        if (file) {
            const uploadedFile = await this.filesService.uploadFile(file);
            changes.imageId = { from: existing.imageId, to: uploadedFile.id };
            updateData.imageId = uploadedFile.id;
        }

        if (Object.keys(updateData).length === 0) {
            return tenantResponseMapper.toResponse(existing as TenantProps);
        }

        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: updateData,
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.UPDATED,
            new TenantUpdatedEvent(tenantId, tenantId, changes, user.userId),
        );

        this.logger.log(`Tenant updated: ${tenantId}`, {
            tenantId,
            changes: Object.keys(changes),
        });

        return tenantResponseMapper.toResponse(updated as TenantProps);
    }

    /**
     * Verify custom domain DNS records
     */
    async verifyCustomDomain(): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;
        const userId = this.tenantContext.getUserId();

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
        });

        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        if (!tenant.customDomain || !tenant.domainVerificationToken) {
            throw new HttpException(
                {
                    message: 'No custom domain configuration found to verify',
                    errorCode: 'NO_DOMAIN_CONFIGURED',
                },
                HttpStatus.BAD_REQUEST,
            );
        }

        const isVerified = await this.dnsVerificationService.verifyTxtRecord(
            tenant.customDomain,
            tenant.domainVerificationToken,
        );

        if (!isVerified) {
            await this.prisma.tenant.update({
                where: { id: tenantId },
                data: { domainVerificationStatus: DomainVerificationStatus.FAILED },
            });
            throw new HttpException(
                {
                    message: 'DNS verification failed. Please check your TXT records.',
                    errorCode: 'DNS_VERIFICATION_FAILED',
                },
                HttpStatus.BAD_REQUEST,
            );
        }

        const now = new Date();
        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { domainVerificationStatus: DomainVerificationStatus.VERIFIED },
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.DOMAIN_VERIFIED,
            new TenantDomainVerifiedEvent(tenantId, tenantId, tenant.customDomain, now, userId),
        );

        this.logger.log(`Domain verified for tenant: ${tenantId}`, {
            tenantId,
            domain: tenant.customDomain,
        });

        return tenantResponseMapper.toResponse(updated as TenantProps);
    }

    /**
     * Get domain status
     */
    async getDomainStatus(): Promise<DomainStatusResponse> {
        const tenantId = this.tenantContext.getTenantId()!;

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
            select: {
                customDomain: true,
                domainVerificationStatus: true,
                domainVerificationToken: true,
            },
        });

        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        const response = new DomainStatusResponse();
        response.customDomain = tenant.customDomain ?? undefined;
        response.domainVerificationStatus = tenant.domainVerificationStatus;
        response.domainVerificationToken = tenant.domainVerificationToken ?? undefined;
        return response;
    }

    /**
     * Check subdomain availability
     */
    async checkSubdomainAvailability(subdomain: string): Promise<SubdomainAvailabilityResponse> {
        const available = await this.subdomainService.isSubdomainAvailable(subdomain);

        const response = new SubdomainAvailabilityResponse();
        response.available = available;
        return response;
    }

    /**
     * Lock tenant account
     */
    async lock(dto: LockTenantDto, user: IAuthenticatedUser): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;

        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(user.userId, dto.password);
        if (!passwordValid) {
            throw new HttpException(
                { message: 'Invalid password', errorCode: 'INVALID_PASSWORD' },
                HttpStatus.UNAUTHORIZED,
            );
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
        });

        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        if (tenant.status === TenantStatus.LOCKED) {
            throw new HttpException(
                { message: 'Tenant is already locked', errorCode: 'ALREADY_LOCKED' },
                HttpStatus.CONFLICT,
            );
        }

        const now = new Date();
        const lockUntil = dto.lockUntil ? new Date(dto.lockUntil) : null;

        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                status: TenantStatus.LOCKED,
                lockedAt: now,
                lockUntil,
                lockReason: dto.reason,
            },
        });

        // Schedule auto-unlock job if lockUntil is set
        if (lockUntil) {
            const delay = lockUntil.getTime() - Date.now();
            if (delay > 0) {
                await this.bullJobsService.addDelayedJob<TenantUnlockJobData>(
                    TENANT_UNLOCK_QUEUE,
                    'auto-unlock',
                    { tenantId, unlockAt: lockUntil },
                    delay,
                );
            }
        }

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.LOCKED,
            new TenantLockedEvent(tenantId, tenantId, dto.reason, lockUntil ?? undefined, now, user.userId),
        );

        this.logger.log(`Tenant locked: ${tenantId}`, {
            tenantId,
            lockUntil,
            reason: dto.reason,
        });

        return tenantResponseMapper.toResponse(updated as TenantProps);
    }

    /**
     * Unlock tenant account
     */
    async unlock(dto: UnlockTenantDto, user: IAuthenticatedUser): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;

        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(user.userId, dto.password);
        if (!passwordValid) {
            throw new HttpException(
                { message: 'Invalid password', errorCode: 'INVALID_PASSWORD' },
                HttpStatus.UNAUTHORIZED,
            );
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
        });

        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        if (tenant.status !== TenantStatus.LOCKED) {
            throw new HttpException(
                { message: 'Tenant is not locked', errorCode: 'NOT_LOCKED' },
                HttpStatus.BAD_REQUEST,
            );
        }

        const now = new Date();
        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                status: TenantStatus.ACTIVE,
                lockedAt: null,
                lockUntil: null,
                lockReason: null,
            },
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.UNLOCKED,
            new TenantUnlockedEvent(tenantId, tenantId, user.userId, now, user.userId),
        );

        this.logger.log(`Tenant unlocked: ${tenantId}`, { tenantId });

        return tenantResponseMapper.toResponse(updated as TenantProps);
    }

    /**
     * Auto-unlock tenant (called by background job)
     */
    async autoUnlock(tenantId: string): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
        });

        if (!tenant || tenant.status !== TenantStatus.LOCKED) {
            return;
        }

        const now = new Date();
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                status: TenantStatus.ACTIVE,
                lockedAt: null,
                lockUntil: null,
                lockReason: null,
            },
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.UNLOCKED,
            new TenantUnlockedEvent(tenantId, tenantId, 'system', now),
        );

        this.logger.log(`Tenant auto-unlocked: ${tenantId}`, { tenantId });
    }

    /**
     * Schedule tenant deletion (30-day grace period)
     */
    async scheduleDeletion(dto: ScheduleDeletionDto, user: IAuthenticatedUser): Promise<DeletionScheduledResponse> {
        const tenantId = this.tenantContext.getTenantId()!;

        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(user.userId, dto.password);
        if (!passwordValid) {
            throw new HttpException(
                { message: 'Invalid password', errorCode: 'INVALID_PASSWORD' },
                HttpStatus.UNAUTHORIZED,
            );
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
        });

        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        if (tenant.status === TenantStatus.DELETION_SCHEDULED) {
            throw new HttpException(
                {
                    message: 'Deletion is already scheduled for this tenant',
                    errorCode: 'DELETION_ALREADY_SCHEDULED',
                },
                HttpStatus.CONFLICT,
            );
        }

        const scheduledAt = new Date();
        const executionDate = new Date();
        executionDate.setDate(executionDate.getDate() + 30);

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                status: TenantStatus.DELETION_SCHEDULED,
                deletionScheduledAt: scheduledAt,
                deletionReason: dto.reason,
            },
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.DELETION_SCHEDULED,
            new TenantDeletionScheduledEvent(tenantId, tenantId, scheduledAt, executionDate, dto.reason, user.userId),
        );

        this.logger.log(`Tenant deletion scheduled: ${tenantId}`, {
            tenantId,
            scheduledAt,
            executionDate,
        });

        const response = new DeletionScheduledResponse();
        response.scheduledAt = scheduledAt;
        response.executionDate = executionDate;
        return response;
    }

    /**
     * Cancel scheduled deletion
     */
    async cancelDeletion(dto: CancelDeletionDto, user: IAuthenticatedUser): Promise<void> {
        const tenantId = this.tenantContext.getTenantId()!;

        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(user.userId, dto.password);
        if (!passwordValid) {
            throw new HttpException(
                { message: 'Invalid password', errorCode: 'INVALID_PASSWORD' },
                HttpStatus.UNAUTHORIZED,
            );
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
        });

        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        if (tenant.status !== TenantStatus.DELETION_SCHEDULED) {
            throw new HttpException(
                {
                    message: 'No deletion is scheduled for this tenant',
                    errorCode: 'NO_DELETION_SCHEDULED',
                },
                HttpStatus.BAD_REQUEST,
            );
        }

        const now = new Date();
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                status: TenantStatus.ACTIVE,
                deletionScheduledAt: null,
                deletionReason: null,
            },
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.DELETION_CANCELLED,
            new TenantDeletionCancelledEvent(tenantId, tenantId, now, user.userId),
        );

        this.logger.log(`Tenant deletion cancelled: ${tenantId}`, { tenantId });
    }

    /**
     * Execute tenant deletion (called by background job after 30 days)
     */
    async executeDeletion(tenantId: string): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
        });

        if (!tenant) {
            return;
        }

        if (tenant.status !== TenantStatus.DELETION_SCHEDULED) {
            throw new HttpException(
                {
                    message: 'Tenant is not scheduled for deletion',
                    errorCode: 'NOT_SCHEDULED_FOR_DELETION',
                },
                HttpStatus.BAD_REQUEST,
            );
        }

        // Verify 30 days have passed
        if (tenant.deletionScheduledAt) {
            const daysPassed = Math.floor((Date.now() - tenant.deletionScheduledAt.getTime()) / (1000 * 60 * 60 * 24));

            if (daysPassed < 30) {
                throw new HttpException(
                    {
                        message: 'Cannot delete tenant before 30-day grace period has passed',
                        errorCode: 'GRACE_PERIOD_NOT_PASSED',
                    },
                    HttpStatus.BAD_REQUEST,
                );
            }
        }

        // Hard delete tenant
        const now = new Date();
        await this.prisma.tenant.delete({
            where: { id: tenantId },
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.DELETED,
            new TenantDeletedEvent(tenantId, tenantId, tenant.name, tenant.slug),
        );

        this.logger.log(`Tenant deleted: ${tenantId}`, {
            tenantId,
            name: tenant.name,
            slug: tenant.slug,
        });
    }

    /**
     * Transfer ownership to another user
     */
    async transferOwnership(dto: TransferOwnershipDto, user: IAuthenticatedUser): Promise<void> {
        const tenantId = this.tenantContext.getTenantId()!;

        // Verify password
        const passwordValid = await this.kratosService.verifyPassword(user.userId, dto.password);
        if (!passwordValid) {
            throw new HttpException(
                { message: 'Invalid password', errorCode: 'INVALID_PASSWORD' },
                HttpStatus.UNAUTHORIZED,
            );
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
        });

        if (!tenant) {
            throw new HttpException(
                { message: 'Tenant not found', errorCode: 'TENANT_NOT_FOUND' },
                HttpStatus.NOT_FOUND,
            );
        }

        // Transfer all resource permissions from old owner to new owner
        const resources = [
            KetoResource.MEMBER,
            KetoResource.INVITATION,
            KetoResource.API_KEY,
            KetoResource.BILLING,
            KetoResource.PLANS,
            KetoResource.SETTINGS,
        ];
        const actions = [KetoRelation.CREATE, KetoRelation.READ, KetoRelation.UPDATE, KetoRelation.DELETE];

        for (const resource of resources) {
            for (const action of actions) {
                await this.ketoService.deleteTuple({
                    namespace: KetoNamespace.TENANT,
                    object: resource,
                    relation: action,
                    subject_id: user.userId,
                });

                await this.ketoService.createTuple({
                    namespace: KetoNamespace.TENANT,
                    object: resource,
                    relation: action,
                    subject_id: dto.newOwnerId,
                });
            }
        }

        const now = new Date();
        this.txEventEmitter.emitAfterCommit(
            TenantEvents.OWNERSHIP_TRANSFERRED,
            new TenantOwnershipTransferredEvent(tenantId, tenantId, user.userId, dto.newOwnerId, now, user.userId),
        );

        this.logger.log(`Tenant ownership transferred: ${tenantId}`, {
            tenantId,
            oldOwnerId: user.userId,
            newOwnerId: dto.newOwnerId,
        });
    }
}
