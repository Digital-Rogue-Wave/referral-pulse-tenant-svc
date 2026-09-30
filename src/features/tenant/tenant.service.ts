import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { ConfigService } from '@nestjs/config';
import type { AllConfigType } from '@config/config.type';
import type { Prisma, Tenant } from '@prisma-gen/generated/client';
import type { BaseDomainEvent } from '@domains/common/events';

import type { IAuthenticatedUser } from '@app/types';

import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';
import { KratosService } from '@common/auth/kratos.service';
import { BaseException } from '@common/exceptions/base.exceptions';

import { SubdomainService } from '../dns/subdomain.service';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { FilesService } from '../files/files.service';
import { UsersService, MemberIdentity } from '../users/users.service';

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
    UpdateVerificationStatusDto,
    VerificationRecordStatus,
    VerificationStatus,
    VerificationType
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

/** A company verification's state as the tenant shows it: an open one (pending or in review) is `pending`. */
const toTenantVerificationStatus = (status: VerificationRecordStatus): VerificationStatus =>
    status === VerificationRecordStatus.VERIFIED
        ? VerificationStatus.VERIFIED
        : status === VerificationRecordStatus.REJECTED
          ? VerificationStatus.REJECTED
          : VerificationStatus.PENDING;

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
        private readonly filesService: FilesService,
        private readonly kratos: KratosService,
        private readonly usersService: UsersService,
        private readonly config: ConfigService<AllConfigType>
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
     * Onboards a new tenant: the tenant, its Owner membership and the role projection are created in one
     * transaction, so a tenant can never exist without an Owner. Keto grants follow from the
     * `tenant.created` / `user.registered` events.
     *
     * Deduplicated on the Ory identity (one identity, one tenant): a replayed Kratos web hook gets the
     * existing tenant back (`onExisting: 'return'`); a user who already has a tenant and asks for another
     * gets a 409 (`'conflict'`).
     */
    async create(
        data: Pick<CreateTenantDto, 'name'> & { slug?: string },
        owner: MemberIdentity,
        options: { file?: Express.Multer.File | Express.MulterS3.File; onExisting: 'return' | 'conflict' }
    ): Promise<TenantResponse> {
        const existing = await this.prisma.user.findUnique({
            where: { kratosIdentityId: owner.identityId },
            select: { tenantId: true, deletedAt: true }
        });
        if (existing && !existing.deletedAt) {
            if (options.onExisting === 'conflict') {
                throw new BaseException('duplicate_resource', 'You already belong to a tenant', HttpStatus.CONFLICT);
            }
            return tenantResponseMapper.toResponse(await this.findOneOrFail(existing.tenantId));
        }

        const id = ulid();
        const slug = data.slug ?? this.generateSlug(data.name, id);
        if ((await this.prisma.tenant.count({ where: { slug } })) > 0) {
            throw new BaseException('duplicate_resource', `Slug "${slug}" is already in use`, HttpStatus.CONFLICT, 'slug');
        }

        const trialStartedAt = this.dateService.nowMoment().toDate();
        const trialEndsAt = this.dateService.nowMoment().add(TRIAL_PERIOD_DAYS, 'days').toDate();
        const imageId = options.file ? await this.uploadLogo(id, options.file) : undefined;

        const { tenant, ownerUser } = await this.prisma.$transaction(async (tx) => {
            const created = await tx.tenant.create({
                data: {
                    id,
                    name: data.name,
                    slug,
                    imageId: imageId ?? null,
                    status: TenantStatus.ACTIVE,
                    verificationStatus: VerificationStatus.PENDING,
                    paymentStatus: 'active',
                    trialStartedAt,
                    trialEndsAt
                }
            });
            // Company verification at signup: the workflow service runs the account_verification workflow.
            const verification = await tx.tenantVerification.create({ data: { tenantId: created.id, verificationType: VerificationType.COMPANY } });
            // Emitted before the owner's user.registered so the tenant's Keto grants are queued first.
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.CREATED,
                new TenantCreatedEvent(created.id, created.id, created.name, created.slug, owner.identityId, trialStartedAt, trialEndsAt, undefined, {
                    dataRegion: created.dataRegion,
                    retentionMonths: created.retentionMonths
                })
            );
            const createdOwner = await this.usersService.createOwner(tx, created.id, owner);
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.VERIFICATION_REQUESTED,
                new TenantVerificationRequestedEvent(created.id, created.id, created.name, createdOwner.id, verification.id)
            );
            return { tenant: created, ownerUser: createdOwner };
        });

        this.logger.log('Tenant created', { tenantId: tenant.id, slug: tenant.slug, ownerUserId: ownerUser.id });
        return tenantResponseMapper.toResponse(tenant);
    }

    /** Self-service tenant creation by a signed-in identity that has no tenant yet. */
    async createForIdentity(
        identityId: string,
        data: Pick<CreateTenantDto, 'name' | 'slug'>,
        file?: Express.Multer.File | Express.MulterS3.File
    ): Promise<TenantResponse> {
        const owner = await this.usersService.identityOf(identityId);
        return this.create(data, owner, { file, onExisting: 'conflict' });
    }

    /** The tenant row does not exist yet, but its id is known — upload under that tenant so the file is scoped to it. */
    private async uploadLogo(tenantId: string, file: Express.Multer.File | Express.MulterS3.File): Promise<string | undefined> {
        try {
            const uploaded = await this.tenantContext.runWithContext({ tenantId, userId: 'system' }, () => this.filesService.uploadFile(file));
            return uploaded.id;
        } catch (err) {
            this.logger.warn('Failed to upload tenant logo, continuing without image', { error: err instanceof Error ? err.message : String(err) });
            return undefined;
        }
    }

    /**
     * Apply a company-verification decision (called by the workflow service's
     * account_verification workflow via the internal endpoint). Updates verification_status
     * and emits tenant.verification_status_changed.
     */
    /**
     * Records the account_verification workflow's report in `tenant_verifications` and, for a company
     * verification, moves `tenants.verification_status` with it — both in one transaction.
     */
    async applyVerificationReport(tenantId: string, dto: UpdateVerificationStatusDto): Promise<TenantResponse> {
        const existing = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!existing) {
            throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
        }
        const type = dto.verificationType ?? VerificationType.COMPANY;
        const decided = dto.status === VerificationRecordStatus.VERIFIED || dto.status === VerificationRecordStatus.REJECTED;
        const tenantStatus = type === VerificationType.COMPANY ? toTenantVerificationStatus(dto.status) : existing.verificationStatus;

        const updated = await this.prisma.$transaction(async (tx) => {
            const record = await this.openVerification(tx, tenantId, type, dto.verificationId);
            const data = {
                status: dto.status,
                reason: dto.reason ?? null,
                reviewedBy: dto.reviewedBy ?? null,
                reviewedAt: decided ? new Date() : null,
                ...(dto.temporalWorkflowId ? { temporalWorkflowId: dto.temporalWorkflowId } : {}),
                ...(dto.temporalRunId ? { temporalRunId: dto.temporalRunId } : {}),
                ...(dto.evidence ? { evidence: dto.evidence as Prisma.InputJsonValue } : {})
            };
            await (record
                ? tx.tenantVerification.update({ where: { id: record.id }, data })
                : tx.tenantVerification.create({ data: { tenantId, verificationType: type, ...data } }));
            if (tenantStatus === existing.verificationStatus) {
                return existing;
            }
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.VERIFICATION_STATUS_CHANGED,
                new TenantVerificationStatusChangedEvent(tenantId, tenantId, existing.verificationStatus, tenantStatus, dto.reason, dto.reviewedBy)
            );
            return tx.tenant.update({ where: { id: tenantId }, data: { verificationStatus: tenantStatus } });
        });

        this.logger.log('Tenant verification report applied', { tenantId, verificationType: type, status: dto.status });
        return tenantResponseMapper.toResponse(updated);
    }

    /** The verification a report is about: the named one, else the latest still open of that type. */
    private async openVerification(tx: Prisma.TransactionClient, tenantId: string, type: VerificationType, verificationId?: string) {
        if (verificationId) {
            const named = await tx.tenantVerification.findFirst({ where: { id: verificationId, tenantId } });
            if (!named) {
                throw new BaseException('resource_not_found', `Verification ${verificationId} not found`, HttpStatus.NOT_FOUND, 'verification_id');
            }
            return named;
        }
        return tx.tenantVerification.findFirst({
            where: { tenantId, verificationType: type, status: { in: [VerificationRecordStatus.PENDING, VerificationRecordStatus.IN_REVIEW] } },
            orderBy: { createdAt: 'desc' }
        });
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
            this.assertCustomDomainsEnabled();
            updateData.customDomain = dto.customDomain;
            updateData.domainVerificationStatus = 'pending';
            updateData.domainVerificationToken = ulid();
            changes.customDomain = { from: tenant.customDomain, to: dto.customDomain };
        }

        if (dto.retentionMonths !== undefined && dto.retentionMonths !== tenant.retentionMonths) {
            updateData.retentionMonths = dto.retentionMonths;
            changes.retentionMonths = { from: tenant.retentionMonths, to: dto.retentionMonths };
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

        const updated = await this.applyChange(tenantId, updateData, (row) => [
            TenantEvents.UPDATED,
            new TenantUpdatedEvent(row.id, row.id, changes, user.userId)
        ]);

        this.logger.log(`Tenant updated: ${tenantId}`, { tenantId, changes: Object.keys(changes) });

        return tenantResponseMapper.toResponse(updated);
    }

    /**
     * Verify the custom domain TXT record for the current tenant.
     */
    async verifyCustomDomain(): Promise<TenantResponse> {
        this.assertCustomDomainsEnabled();
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

        const domain = tenant.customDomain;
        const updated = await this.applyChange(tenantId, { domainVerificationStatus: newStatus }, (row) =>
            result.verified
                ? [TenantEvents.DOMAIN_VERIFIED, new TenantDomainVerifiedEvent(row.id, row.id, domain, this.dateService.nowMoment().toDate())]
                : null
        );

        return tenantResponseMapper.toResponse(updated);
    }

    /**
     * Transfer ownership of the current tenant to another member (membership change lives in UsersService).
     */
    async transferOwnership(dto: TransferOwnershipDto, user: IAuthenticatedUser): Promise<void> {
        await this.usersService.transferOwnership(user, dto.newOwnerId);
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

        const updated = await this.applyChange(tenantId, { deletionScheduledAt, deletionDueAt: executionDate, deletionReason: reason }, () => [
            TenantEvents.DELETION_SCHEDULED,
            new TenantDeletionScheduledEvent(tenantId, tenantId, deletionScheduledAt, executionDate, reason, user.userId)
        ]);

        this.logger.log(`Tenant deletion scheduled: ${tenantId}`, { tenantId, executionDate });

        return {
            tenantId,
            deletionScheduledAt: updated.deletionScheduledAt!,
            deletionDueAt: updated.deletionDueAt!,
            deletionReason: updated.deletionReason
        };
    }

    /**
     * Cancel a scheduled deletion for the current tenant.
     */
    async cancelDeletion(_dto: CancelDeletionDto, user: IAuthenticatedUser): Promise<void> {
        const tenantId = this.tenantContext.getTenantId()!;
        await this.findOneOrFail(tenantId);

        await this.applyChange(tenantId, { deletionScheduledAt: null, deletionDueAt: null, deletionReason: null }, () => [
            TenantEvents.DELETION_CANCELLED,
            new TenantDeletionCancelledEvent(tenantId, tenantId, this.dateService.nowMoment().toDate(), user.userId)
        ]);

        this.logger.log(`Tenant deletion cancelled: ${tenantId}`, { tenantId });
    }

    // =========================================================
    // Lock / Unlock
    // =========================================================

    /**
     * Lock the current tenant (aware endpoint).
     */
    async lock(dto: LockTenantDto, user: IAuthenticatedUser): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;

        await this.assertPasswordConfirmed(user, tenantId, dto.password);

        return this.lockTenant(tenantId, dto.reason, dto.lockUntil ? new Date(dto.lockUntil) : null, user.userId);
    }

    /** Platform-admin lock of any tenant (no password: the platform role is checked live in Keto). */
    async lockAsAdmin(tenantId: string, reason: string, lockUntil: Date | null, actorId: string): Promise<TenantResponse> {
        const tenant = await this.findOneOrFail(tenantId);
        if (tenant.status === TenantStatus.CLOSED) {
            throw new BaseException('state_conflict', `Tenant ${tenantId} is closed`, HttpStatus.CONFLICT);
        }
        return this.lockTenant(tenantId, reason, lockUntil, actorId);
    }

    async unlockAsAdmin(tenantId: string, actorId: string): Promise<TenantResponse> {
        const tenant = await this.findOneOrFail(tenantId);
        if (tenant.status !== TenantStatus.LOCKED) {
            throw new BaseException('state_conflict', `Tenant ${tenantId} is not locked`, HttpStatus.CONFLICT);
        }
        return this.performUnlock(tenantId, actorId);
    }

    /** Unlocks every tenant whose `lock_until` has passed. Returns how many were unlocked. */
    async unlockExpired(now = new Date()): Promise<number> {
        const expired = await this.prisma.tenant.findMany({
            where: { status: TenantStatus.LOCKED, lockUntil: { lte: now } },
            select: { id: true },
            take: 100
        });
        for (const tenant of expired) {
            await this.performUnlock(tenant.id);
        }
        return expired.length;
    }

    private async lockTenant(tenantId: string, reason: string, lockUntil: Date | null, actorId: string): Promise<TenantResponse> {
        const updated = await this.applyChange(
            tenantId,
            { status: TenantStatus.LOCKED, lockedAt: new Date(), lockUntil, lockReason: reason },
            (row) => [TenantEvents.LOCKED, new TenantLockedEvent(tenantId, tenantId, reason, row.lockedAt!, lockUntil ?? undefined, actorId)]
        );
        this.logger.log(`Tenant locked: ${tenantId}`, { tenantId, reason, lockUntil });
        return tenantResponseMapper.toResponse(updated);
    }

    /**
     * Unlock the current tenant (aware endpoint).
     */
    async unlock(dto: UnlockTenantDto, user: IAuthenticatedUser): Promise<TenantResponse> {
        const tenantId = this.tenantContext.getTenantId()!;

        await this.assertPasswordConfirmed(user, tenantId, dto.password);

        return this.performUnlock(tenantId, user.userId);
    }

    /**
     * Re-confirm the acting user's own password through Ory Kratos before a
     * destructive tenant action (REFER-353). A valid session proves the user is
     * signed in; it does not prove the person at the keyboard is them.
     *
     * The JWT carries the application user id, not the Kratos identity id, so the
     * identity has to be resolved from `users.kratos_identity_id` first.
     */
    private async assertPasswordConfirmed(user: IAuthenticatedUser, tenantId: string, password: string): Promise<void> {
        const record = await this.prisma.user.findFirst({
            where: { id: user.userId, tenantId, deletedAt: null },
            select: { kratosIdentityId: true }
        });

        if (!record?.kratosIdentityId) {
            throw new BaseException('authentication_error', 'Unable to confirm your identity for this action.', HttpStatus.UNAUTHORIZED);
        }

        const confirmed = await this.kratos.verifyPassword(record.kratosIdentityId, password);

        if (!confirmed) {
            this.logger.warn('Password confirmation failed for a destructive tenant action', { tenantId, userId: user.userId });
            throw new BaseException('authentication_error', 'Password confirmation failed.', HttpStatus.UNAUTHORIZED);
        }
    }

    /**
     * Auto-unlock called by the TenantUnlockProcessor (BullMQ job).
     */
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

        const updated = await this.applyChange(id, { status: TenantStatus.SUSPENDED, suspendedAt: new Date() }, (row) => [
            TenantEvents.SUSPENDED,
            new TenantSuspendedEvent(id, id, reason, row.suspendedAt!)
        ]);

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

        const updated = await this.applyChange(id, { status: TenantStatus.ACTIVE, suspendedAt: null }, () => [
            TenantEvents.UNSUSPENDED,
            new TenantUnsuspendedEvent(id, id, this.dateService.nowMoment().toDate())
        ]);

        this.logger.log(`Tenant unsuspended: ${id}`, { tenantId: id });

        return tenantResponseMapper.toResponse(updated);
    }

    // =========================================================
    // Private helpers
    // =========================================================

    /**
     * A custom domain is accepted only when it can actually be served. Provisioning (ACM certificate and
     * CloudFront alias) is not built yet, so the feature is off unless FEATURE_CUSTOM_DOMAINS=true.
     */
    private assertCustomDomainsEnabled(): void {
        if (!this.config.get('app.customDomainsEnabled', { infer: true })) {
            throw new BaseException('state_conflict', 'Custom domains are not available yet', HttpStatus.CONFLICT, 'custom_domain');
        }
    }

    /**
     * Applies a tenant change and emits its event in one transaction: the published event is written to the
     * outbox before commit, so it exists exactly when the change does.
     */
    private async applyChange(
        tenantId: string,
        data: Prisma.TenantUpdateInput,
        toEvent: (updated: Tenant) => [string, BaseDomainEvent] | null
    ): Promise<Tenant> {
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.tenant.update({ where: { id: tenantId }, data });
            const event = toEvent(updated);
            if (event) {
                this.txEventEmitter.emitAfterCommit(event[0], event[1]);
            }
            return updated;
        });
    }

    private async performUnlock(tenantId: string, userId?: string): Promise<TenantResponse> {
        const updated = await this.applyChange(tenantId, { status: TenantStatus.ACTIVE, lockedAt: null, lockUntil: null, lockReason: null }, () => [
            TenantEvents.UNLOCKED,
            new TenantUnlockedEvent(tenantId, tenantId, userId ?? 'system', this.dateService.nowMoment().toDate(), userId)
        ]);

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
