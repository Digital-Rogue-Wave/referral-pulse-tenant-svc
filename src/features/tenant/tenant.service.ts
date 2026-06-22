import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import type { Tenant } from '@prisma-gen/generated/client';

import type { IAuthenticatedUser } from '@app/types';

import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';

import { SubdomainService } from '../dns/subdomain.service';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { FilesService } from '../files/files.service';

import {
    CreateTenantDto,
    UpdateTenantDto,
    TransferOwnershipDto,
    ScheduleDeletionDto,
    CancelDeletionDto,
    LockTenantDto,
    UnlockTenantDto,
    TenantResponse,
    TenantProfileResponse,
    DomainStatusResponse,
    SubdomainAvailabilityResponse,
    DeletionScheduledResponse,
    tenantResponseMapper,
    TenantStatus,
    VerificationStatus
} from '@domains/tenant';

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
    TenantVerificationRequestedEvent,
    TenantVerificationStatusChangedEvent,
    TenantEvents
} from '@domains/tenant/events/tenant.events';

/** Default trial period in days */
const TRIAL_PERIOD_DAYS = 14;

/** Default days until deletion after scheduling */
const DEFAULT_DELETION_DAYS = 30;

@Injectable()
export class TenantService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService,
        private readonly subdomainService: SubdomainService,
        private readonly dnsVerificationService: DnsVerificationService,
        private readonly filesService: FilesService
    ) {
        this.logger.setContext(TenantService.name);
    }

    // =========================================================
    // Read
    // =========================================================

    /**
     * Find a tenant by ID without any tenant-scoping.
     * Used by guards and processors that operate outside of a tenant context.
     */
    async findOneById(id: string): Promise<Tenant | null> {
        return this.prisma.tenant.findUnique({
            where: { id, deletedAt: null }
        });
    }

    /**
     * Find a tenant or throw 404.
     */
    async findOneOrFail(id: string): Promise<Tenant> {
        const tenant = await this.findOneById(id);
        if (!tenant) {
            throw new NotFoundException(`Tenant ${id} not found`);
        }
        return tenant;
    }

    /**
     * Get full profile of the current tenant (from context).
     */
    async getProfile(): Promise<TenantProfileResponse> {
        const tenantId = this.tenantContext.getTenantId()!;
        const tenant = await this.findOneOrFail(tenantId);
        return tenantResponseMapper.toResponse(tenant) as TenantProfileResponse;
    }

    /**
     * Get custom domain status for the current tenant.
     */
    async getDomainStatus(): Promise<DomainStatusResponse> {
        const tenantId = this.tenantContext.getTenantId()!;
        const tenant = await this.findOneOrFail(tenantId);

        return {
            customDomain: tenant.customDomain ?? null,
            domainVerificationStatus: tenant.domainVerificationStatus ?? null,
            domainVerificationToken: tenant.domainVerificationToken ?? undefined
        };
    }

    /**
     * Check whether a subdomain is available.
     */
    async checkSubdomainAvailability(subdomain: string): Promise<SubdomainAvailabilityResponse> {
        const result = await this.subdomainService.checkSubdomain(subdomain);

        return {
            subdomain,
            available: result.available ?? false,
            message: result.message
        };
    }

    // =========================================================
    // Create
    // =========================================================

    /**
     * Create a new tenant.
     * Called by the Ory signup webhook and the agnostic controller.
     */
    async create(
        data: CreateTenantDto | { name: string; ownerId: string; slug?: string },
        file?: Express.Multer.File | Express.MulterS3.File
    ): Promise<TenantResponse> {
        const id = ulid();
        const slug = (data as CreateTenantDto).slug ? (data as CreateTenantDto).slug! : this.generateSlug((data as { name: string }).name, id);
        const ownerId = (data as { ownerId?: string }).ownerId ?? 'system';

        // Validate slug uniqueness
        const slugTaken = await this.prisma.tenant.count({ where: { slug } });
        if (slugTaken > 0) {
            throw new BadRequestException(`Slug "${slug}" is already in use`);
        }

        const trialStartedAt = this.dateService.nowMoment().toDate();
        const trialEndsAt = this.dateService.nowMoment().add(TRIAL_PERIOD_DAYS, 'days').toDate();

        // Handle optional logo upload. The tenant row does not exist yet, but its id is known — run the
        // upload under that tenant's context so the file is stored and scoped under the new tenant.
        let imageId: string | undefined;
        if (file) {
            try {
                const uploaded = await this.tenantContext.runWithContext({ tenantId: id, userId: ownerId }, () => this.filesService.uploadFile(file));
                imageId = uploaded.id;
            } catch (err) {
                this.logger.warn('Failed to upload tenant logo, continuing without image', {
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }

        const tenant = await this.prisma.tenant.create({
            data: {
                id,
                name: data.name,
                slug,
                imageId: imageId ?? null,
                status: TenantStatus.ACTIVE,
                paymentStatus: 'active',
                trialStartedAt,
                trialEndsAt
            }
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.CREATED,
            new TenantCreatedEvent(tenant.id, tenant.id, tenant.name, tenant.slug, ownerId, trialStartedAt, trialEndsAt)
        );

        // Company verification at signup (referralai_system_architecture_v1.md §Company Verification):
        // request verification so the workflow service can run the account_verification workflow.
        this.txEventEmitter.emitAfterCommit(
            TenantEvents.VERIFICATION_REQUESTED,
            new TenantVerificationRequestedEvent(tenant.id, tenant.id, tenant.name, ownerId)
        );

        this.logger.log(`Tenant created: ${tenant.id}`, { tenantId: tenant.id, slug: tenant.slug });

        return tenantResponseMapper.toResponse(tenant);
    }

    /**
     * Apply a company-verification decision (called by the workflow service's
     * account_verification workflow via the internal endpoint). Updates verification_status
     * and emits tenant.verification_status_changed.
     */
    async setVerificationStatus(tenantId: string, status: VerificationStatus, reason?: string, reviewedBy?: string): Promise<TenantResponse> {
        const existing = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!existing) {
            throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
        }

        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { verificationStatus: status }
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.VERIFICATION_STATUS_CHANGED,
            new TenantVerificationStatusChangedEvent(tenantId, tenantId, existing.verificationStatus, status, reason, reviewedBy)
        );

        this.logger.log(`Tenant verification status changed: ${tenantId}`, {
            tenantId,
            previousStatus: existing.verificationStatus,
            newStatus: status
        });

        return tenantResponseMapper.toResponse(updated);
    }

    // =========================================================
    // Update
    // =========================================================

    /**
     * Update current tenant's settings (aware context).
     */
    async update(dto: UpdateTenantDto, user: IAuthenticatedUser, file?: Express.Multer.File | Express.MulterS3.File): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;
        const tenant = await this.findOneOrFail(tenantId);

        const updateData: Record<string, unknown> = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};

        if (dto.name !== undefined && dto.name !== tenant.name) {
            updateData.name = dto.name;
            changes.name = { from: tenant.name, to: dto.name };
        }

        if (dto.customDomain !== undefined && dto.customDomain !== tenant.customDomain) {
            updateData.customDomain = dto.customDomain;
            updateData.domainVerificationStatus = 'pending';
            updateData.domainVerificationToken = ulid();
            changes.customDomain = { from: tenant.customDomain, to: dto.customDomain };
        }

        if (file) {
            try {
                const uploaded = await this.filesService.uploadFile(file);
                updateData.imageId = uploaded.id;
                changes.imageId = { from: tenant.imageId, to: uploaded.id };
            } catch (err) {
                this.logger.warn('Failed to upload tenant logo, continuing without image update', {
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }

        if (Object.keys(updateData).length === 0) {
            return tenantResponseMapper.toResponse(tenant);
        }

        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: updateData
        });

        this.txEventEmitter.emitAfterCommit(TenantEvents.UPDATED, new TenantUpdatedEvent(updated.id, updated.id, changes, user.userId));

        this.logger.log(`Tenant updated: ${tenantId}`, { tenantId, changes: Object.keys(changes) });

        return tenantResponseMapper.toResponse(updated);
    }

    /**
     * Verify the custom domain TXT record for the current tenant.
     */
    async verifyCustomDomain(): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;
        const tenant = await this.findOneOrFail(tenantId);

        if (!tenant.customDomain) {
            throw new BadRequestException('No custom domain configured for this tenant');
        }

        if (!tenant.domainVerificationToken) {
            throw new BadRequestException('No verification token found; please re-add the domain to regenerate it');
        }

        const result = await this.dnsVerificationService.verifyTxtRecord(tenant.customDomain, tenant.domainVerificationToken);

        const newStatus = result.verified ? 'verified' : 'failed';

        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { domainVerificationStatus: newStatus }
        });

        if (result.verified) {
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.DOMAIN_VERIFIED,
                new TenantDomainVerifiedEvent(updated.id, updated.id, tenant.customDomain, this.dateService.nowMoment().toDate())
            );
        }

        return tenantResponseMapper.toResponse(updated);
    }

    /**
     * Transfer ownership of the current tenant to another user.
     */
    async transferOwnership(dto: TransferOwnershipDto, user: IAuthenticatedUser): Promise<void> {
        const tenantId = this.tenantContext.getTenantId()!;
        await this.findOneOrFail(tenantId);

        // NOTE: actual Keto permission re-assignment happens in TenantListener
        this.txEventEmitter.emitAfterCommit(
            TenantEvents.OWNERSHIP_TRANSFERRED,
            new TenantOwnershipTransferredEvent(tenantId, tenantId, user.userId, dto.newOwnerId, this.dateService.nowMoment().toDate(), user.userId)
        );

        this.logger.log(`Tenant ownership transferred: ${tenantId}`, {
            tenantId,
            from: user.userId,
            to: dto.newOwnerId
        });
    }

    // =========================================================
    // Deletion lifecycle
    // =========================================================

    /**
     * Schedule soft-deletion of the current tenant.
     */
    async scheduleDeletion(dto: ScheduleDeletionDto, user: IAuthenticatedUser): Promise<DeletionScheduledResponse> {
        const tenantId = this.tenantContext.getTenantId()!;
        await this.findOneOrFail(tenantId);

        const days = dto.daysUntilDeletion ?? DEFAULT_DELETION_DAYS;
        const deletionScheduledAt = this.dateService.nowMoment().toDate();
        const executionDate = this.dateService.nowMoment().add(days, 'days').toDate();
        const reason = dto.reason ?? 'User requested deletion';

        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                deletionScheduledAt,
                deletionReason: reason
            }
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.DELETION_SCHEDULED,
            new TenantDeletionScheduledEvent(tenantId, tenantId, deletionScheduledAt, executionDate, reason, user.userId)
        );

        this.logger.log(`Tenant deletion scheduled: ${tenantId}`, { tenantId, executionDate });

        return {
            tenantId,
            deletionScheduledAt: updated.deletionScheduledAt!,
            deletionReason: updated.deletionReason
        };
    }

    /**
     * Cancel a scheduled deletion for the current tenant.
     */
    async cancelDeletion(_dto: CancelDeletionDto, user: IAuthenticatedUser): Promise<void> {
        const tenantId = this.tenantContext.getTenantId()!;
        await this.findOneOrFail(tenantId);

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                deletionScheduledAt: null,
                deletionReason: null
            }
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.DELETION_CANCELLED,
            new TenantDeletionCancelledEvent(tenantId, tenantId, this.dateService.nowMoment().toDate(), user.userId)
        );

        this.logger.log(`Tenant deletion cancelled: ${tenantId}`, { tenantId });
    }

    /**
     * Execute the actual hard delete of a tenant (called by BullMQ processor).
     */
    async executeDeletion(tenantId: string): Promise<void> {
        const tenant = await this.findOneOrFail(tenantId);

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                status: TenantStatus.DELETED,
                deletedAt: new Date()
            }
        });

        this.txEventEmitter.emitAfterCommit(TenantEvents.DELETED, new TenantDeletedEvent(tenantId, tenantId, tenant.name, tenant.slug));

        this.logger.log(`Tenant deleted: ${tenantId}`, { tenantId });
    }

    // =========================================================
    // Lock / Unlock
    // =========================================================

    /**
     * Lock the current tenant (aware endpoint).
     */
    async lock(dto: LockTenantDto, user: IAuthenticatedUser): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;

        const lockUntil = dto.lockUntil ? new Date(dto.lockUntil) : null;

        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                status: TenantStatus.LOCKED,
                lockedAt: new Date(),
                lockUntil,
                lockReason: dto.reason
            }
        });

        const lockedAt = updated.lockedAt!;

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.LOCKED,
            new TenantLockedEvent(tenantId, tenantId, dto.reason, lockedAt, lockUntil ?? undefined, user.userId)
        );

        this.logger.log(`Tenant locked: ${tenantId}`, { tenantId, reason: dto.reason });

        return tenantResponseMapper.toResponse(updated);
    }

    /**
     * Unlock the current tenant (aware endpoint).
     */
    async unlock(_dto: UnlockTenantDto, user: IAuthenticatedUser): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;
        return this.performUnlock(tenantId, user.userId);
    }

    /**
     * Auto-unlock called by the TenantUnlockProcessor (BullMQ job).
     */
    async autoUnlock(tenantId: string): Promise<void> {
        await this.performUnlock(tenantId);
    }

    // =========================================================
    // Suspend / Unsuspend (admin)
    // =========================================================

    /**
     * Suspend a tenant by ID (admin action).
     */
    async suspend(id: string, reason: string): Promise<TenantResponse> {
        const tenant = await this.findOneOrFail(id);

        if (tenant.status === TenantStatus.SUSPENDED) {
            throw new BadRequestException(`Tenant ${id} is already suspended`);
        }

        const updated = await this.prisma.tenant.update({
            where: { id },
            data: {
                status: TenantStatus.SUSPENDED,
                suspendedAt: new Date()
            }
        });

        this.txEventEmitter.emitAfterCommit(TenantEvents.SUSPENDED, new TenantSuspendedEvent(id, id, reason, updated.suspendedAt!));

        this.logger.log(`Tenant suspended: ${id}`, { tenantId: id, reason });

        return tenantResponseMapper.toResponse(updated);
    }

    /**
     * Unsuspend a tenant by ID (admin action).
     */
    async unsuspend(id: string): Promise<TenantResponse> {
        const tenant = await this.findOneOrFail(id);

        if (tenant.status !== TenantStatus.SUSPENDED) {
            throw new BadRequestException(`Tenant ${id} is not suspended`);
        }

        const updated = await this.prisma.tenant.update({
            where: { id },
            data: {
                status: TenantStatus.ACTIVE,
                suspendedAt: null
            }
        });

        this.txEventEmitter.emitAfterCommit(TenantEvents.UNSUSPENDED, new TenantUnsuspendedEvent(id, id, this.dateService.nowMoment().toDate()));

        this.logger.log(`Tenant unsuspended: ${id}`, { tenantId: id });

        return tenantResponseMapper.toResponse(updated);
    }

    // =========================================================
    // Private helpers
    // =========================================================

    private async performUnlock(tenantId: string, userId?: string): Promise<TenantResponse> {
        const updated = await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                status: TenantStatus.ACTIVE,
                lockedAt: null,
                lockUntil: null,
                lockReason: null
            }
        });

        this.txEventEmitter.emitAfterCommit(
            TenantEvents.UNLOCKED,
            new TenantUnlockedEvent(tenantId, tenantId, userId ?? 'system', this.dateService.nowMoment().toDate(), userId)
        );

        this.logger.log(`Tenant unlocked: ${tenantId}`, { tenantId, unlockedBy: userId ?? 'system' });

        return tenantResponseMapper.toResponse(updated);
    }

    private generateSlug(name: string, fallback: string): string {
        const base = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 32);

        return base.length >= 3 ? base : fallback.toLowerCase().slice(0, 32);
    }
}
