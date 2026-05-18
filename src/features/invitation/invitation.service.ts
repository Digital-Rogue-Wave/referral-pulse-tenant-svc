import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { prismaPaginate, PaginateQuery, Paginated } from '@common/nestjs-prisma-pagination';
import type { AppConfig } from '@config/app.config';

import {
    InvitationProps,
    InvitationStatus,
    CreateInvitationDto,
    InvitationResponse,
    InvitationWithTokenResponse,
    InvitationValidationResponse,
    invitationResponseMapper,
    InvitationCreatedEvent,
    InvitationAcceptedEvent,
    InvitationRevokedEvent,
    InvitationRejectedEvent,
    InvitationResentEvent,
} from '@domains/invitation';
import { TeamMemberStatus } from '@domains/team-member';

import { INVITATION_PAGINATE_CONFIG } from './invitation.pagination';

/**
 * Service responsible for Invitation management
 * Combines tenant-aware and agnostic operations
 */
@Injectable()
export class InvitationService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly tenantContext: TenantContextService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly configService: ConfigService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(InvitationService.name);
    }

    /** Tenant-scoped Invitation delegate */
    private get invitation() {
        return this.tenantAware.forModel(this.prisma.invitation);
    }

    /**
     * Create a new invitation (tenant-aware)
     */
    async create(userId: string, dto: CreateInvitationDto): Promise<InvitationWithTokenResponse> {
        // tenantId is guaranteed by TenantAwareService/guards
        const tenantId = this.tenantContext.getTenantId()!;
        const token = this.generateToken();
        const expiresAt = this.calculateExpiryDate();

        // Check if there's already a pending invitation for this email
        const existing = await this.invitation.findFirst({
            where: {
                email: dto.email,
                status: InvitationStatus.PENDING,
                deletedAt: null,
            },
        });

        if (existing) {
            throw new BadRequestException(`A pending invitation already exists for ${dto.email}`);
        }

        const saved = (await this.invitation.create({
            data: {
                email: dto.email,
                role: dto.role,
                token,
                expiresAt,
                status: InvitationStatus.PENDING,
            },
        })) as InvitationProps;

        const event = new InvitationCreatedEvent(
            saved.id,
            tenantId,
            {
                invitationId: saved.id,
                tenantId: saved.tenantId,
                email: saved.email,
                role: saved.role,
                token: saved.token,
                expiresAt: saved.expiresAt,
                createdAt: saved.createdAt,
            },
            userId,
        );
        this.txEventEmitter.emitAfterCommit('invitation.created', event);
        this.txEventEmitter.emitAfterCommit('audit.invitation.created', event);

        this.logger.log(`Invitation created: ${saved.id}`, {
            invitationId: saved.id,
            email: saved.email,
            role: saved.role,
        });

        return invitationResponseMapper.toResponseWithToken(saved);
    }

    /**
     * List all invitations for a tenant with pagination
     */
    async findAll(query: PaginateQuery): Promise<Paginated<InvitationResponse>> {
        const baseWhere = this.tenantAware.withTenantFilter({ deletedAt: null });
        const result = await prismaPaginate(query, this.prisma.invitation, INVITATION_PAGINATE_CONFIG, baseWhere);

        return {
            data: invitationResponseMapper.toResponseArray(result.data as InvitationProps[]),
            meta: result.meta as Paginated<InvitationResponse>['meta'],
            links: result.links,
        };
    }

    /**
     * Get a single invitation by ID (tenant-aware)
     */
    async findById(id: string): Promise<InvitationResponse> {
        const invitation = (await this.invitation.findUnique({
            where: { id },
        })) as InvitationProps | null;

        if (!invitation) {
            throw new NotFoundException(`Invitation with ID ${id} not found`);
        }

        return invitationResponseMapper.toResponse(invitation);
    }

    /**
     * Revoke an invitation (tenant-aware)
     */
    async revoke(id: string, userId: string): Promise<void> {
        const existing = (await this.invitation.findUnique({
            where: { id },
        })) as InvitationProps | null;

        if (!existing) {
            throw new NotFoundException(`Invitation with ID ${id} not found`);
        }

        if (existing.status !== InvitationStatus.PENDING) {
            throw new BadRequestException('Only pending invitations can be revoked');
        }

        await this.invitation.update({
            where: { id },
            data: { status: InvitationStatus.REVOKED },
        });

        const event = new InvitationRevokedEvent(
            id,
            existing.tenantId,
            {
                invitationId: id,
                tenantId: existing.tenantId,
                email: existing.email,
                revokedBy: userId,
                revokedAt: new Date(),
            },
            userId,
        );
        this.txEventEmitter.emitAfterCommit('invitation.revoked', event);
        this.txEventEmitter.emitAfterCommit('audit.invitation.revoked', event);

        this.logger.log(`Invitation revoked: ${id}`, { invitationId: id });
    }

    /**
     * Resend an invitation (tenant-aware)
     */
    async resend(id: string, userId: string): Promise<InvitationWithTokenResponse> {
        const existing = (await this.invitation.findUnique({
            where: { id },
        })) as InvitationProps | null;

        if (!existing) {
            throw new NotFoundException(`Invitation with ID ${id} not found`);
        }

        if (existing.status !== InvitationStatus.PENDING && existing.status !== InvitationStatus.EXPIRED) {
            throw new BadRequestException('Only pending or expired invitations can be resent');
        }

        const newExpiresAt = this.calculateExpiryDate();

        const updated = (await this.invitation.update({
            where: { id },
            data: {
                expiresAt: newExpiresAt,
                status: InvitationStatus.PENDING,
            },
        })) as InvitationProps;

        const resentEvent = new InvitationResentEvent(
            id,
            updated.tenantId,
            {
                invitationId: id,
                tenantId: updated.tenantId,
                email: updated.email,
                newExpiresAt,
                resentAt: new Date(),
            },
            userId,
        );
        this.txEventEmitter.emitAfterCommit('invitation.resent', resentEvent);
        this.txEventEmitter.emitAfterCommit('audit.invitation.resent', resentEvent);

        this.logger.log(`Invitation resent: ${id}`, { invitationId: id });

        return invitationResponseMapper.toResponseWithToken(updated);
    }

    // ============================================================================
    // Public (Agnostic) Operations - No tenant context required
    // ============================================================================

    /**
     * Validate an invitation by token (public endpoint)
     */
    async validate(token: string): Promise<InvitationValidationResponse> {
        const invitation = (await this.prisma.invitation.findUnique({
            where: { token },
        })) as InvitationProps | null;

        if (!invitation) {
            return { valid: false, message: 'Invitation not found' };
        }

        if (invitation.status !== InvitationStatus.PENDING) {
            return {
                valid: false,
                message: `Invitation is ${invitation.status.toLowerCase()}`,
            };
        }

        if (invitation.expiresAt < new Date()) {
            // Mark as expired
            await this.prisma.invitation.update({
                where: { id: invitation.id },
                data: { status: InvitationStatus.EXPIRED },
            });
            return { valid: false, message: 'Invitation has expired' };
        }

        return {
            valid: true,
            email: invitation.email,
            role: invitation.role,
            tenantId: invitation.tenantId,
        };
    }

    /**
     * Accept an invitation by token (public endpoint)
     */
    async accept(token: string, userId: string): Promise<InvitationResponse> {
        const invitation = (await this.prisma.invitation.findUnique({
            where: { token },
        })) as InvitationProps | null;

        if (!invitation) {
            throw new NotFoundException('Invitation not found');
        }

        if (invitation.status !== InvitationStatus.PENDING) {
            throw new BadRequestException(`Invitation is ${invitation.status.toLowerCase()}`);
        }

        if (invitation.expiresAt < new Date()) {
            await this.prisma.invitation.update({
                where: { id: invitation.id },
                data: { status: InvitationStatus.EXPIRED },
            });
            throw new BadRequestException('Invitation has expired');
        }

        // Update invitation status
        const updated = (await this.prisma.invitation.update({
            where: { id: invitation.id },
            data: { status: InvitationStatus.ACCEPTED },
        })) as InvitationProps;

        // Create team member with specific tenantId (bypassing tenant context)
        await this.prisma.teamMember.create({
            data: {
                userId,
                tenantId: invitation.tenantId,
                role: invitation.role,
                status: TeamMemberStatus.ACTIVE,
            },
        });

        const acceptedEvent = new InvitationAcceptedEvent(
            invitation.id,
            invitation.tenantId,
            {
                invitationId: invitation.id,
                tenantId: invitation.tenantId,
                email: invitation.email,
                role: invitation.role,
                userId,
                acceptedAt: new Date(),
            },
            userId,
        );
        this.txEventEmitter.emitAfterCommit('invitation.accepted', acceptedEvent);
        this.txEventEmitter.emitAfterCommit('audit.invitation.accepted', acceptedEvent);

        this.logger.log(`Invitation accepted: ${invitation.id}`, {
            invitationId: invitation.id,
            userId,
        });

        return invitationResponseMapper.toResponse(updated);
    }

    /**
     * Reject an invitation by token (public endpoint)
     */
    async reject(token: string): Promise<InvitationResponse> {
        const invitation = (await this.prisma.invitation.findUnique({
            where: { token },
        })) as InvitationProps | null;

        if (!invitation) {
            throw new NotFoundException('Invitation not found');
        }

        if (invitation.status !== InvitationStatus.PENDING) {
            throw new BadRequestException(`Invitation is ${invitation.status.toLowerCase()}`);
        }

        const updated = (await this.prisma.invitation.update({
            where: { id: invitation.id },
            data: { status: InvitationStatus.REJECTED },
        })) as InvitationProps;

        const rejectedEvent = new InvitationRejectedEvent(invitation.id, invitation.tenantId, {
            invitationId: invitation.id,
            tenantId: invitation.tenantId,
            email: invitation.email,
            rejectedAt: new Date(),
        });
        this.txEventEmitter.emitAfterCommit('invitation.rejected', rejectedEvent);
        this.txEventEmitter.emitAfterCommit('audit.invitation.rejected', rejectedEvent);

        this.logger.log(`Invitation rejected: ${invitation.id}`, {
            invitationId: invitation.id,
        });

        return invitationResponseMapper.toResponse(updated);
    }

    // ============================================================================
    // Private helpers
    // ============================================================================

    private generateToken(): string {
        return randomBytes(32).toString('hex');
    }

    private calculateExpiryDate(): Date {
        const appConfig = this.configService.get<AppConfig>('app');
        const expiryDays = appConfig?.invitationExpiryDays ?? 7;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiryDays);
        return expiresAt;
    }
}
