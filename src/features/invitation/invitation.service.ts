import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { prismaPaginate, PaginateQuery, Paginated } from '@common/nestjs-prisma-pagination';
import { InvitationStatusEnum } from '@common/enums/invitation.enum';
import type { IAuthenticatedUser } from '@app/types';

import {
    CreateInvitationDto,
    InvitationProps,
    InvitationResponse,
    PublicInvitationResponse,
    invitationResponseMapper,
    publicInvitationResponseMapper,
    InvitationCreatedEvent,
    InvitationResentEvent
} from '@domains/invitation';
import { UserResponse, userResponseMapper } from '@domains/user';

import { UsersService } from '@app/features/users/users.service';
import { INVITATION_PAGINATE_CONFIG } from './invitation.pagination';

/**
 * Tenant member invitations (sanctioned extension — not in the canonical API contract; see NOTE.md).
 * Admin side is tenant-scoped (create/list/resend/revoke); acceptance is token-based and reuses the
 * invitee's own Ory identity (Kratos owns credentials) to provision the membership.
 */
@Injectable()
export class InvitationService {
    private readonly INVITATION_TTL_DAYS = 7;

    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly usersService: UsersService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(InvitationService.name);
    }

    /** Tenant-scoped Invitation delegate */
    private get invitation() {
        return this.tenantAware.forModel(this.prisma.invitation);
    }

    async create(actingUserId: string, dto: CreateInvitationDto): Promise<InvitationResponse> {
        const existing = await this.invitation.findFirst({ where: { email: dto.email, status: InvitationStatusEnum.PENDING } });
        if (existing) {
            throw new ConflictException(`A pending invitation already exists for ${dto.email}`);
        }

        const token = this.generateToken();
        const expiresAt = this.expiry();

        const saved = (await this.invitation.create({
            data: { email: dto.email, role: dto.role, status: InvitationStatusEnum.PENDING, token, expiresAt }
        })) as InvitationProps;

        this.txEventEmitter.emitAfterCommit(
            'invitation.created',
            new InvitationCreatedEvent(
                saved.id,
                saved.tenantId,
                { invitationId: saved.id, tenantId: saved.tenantId, email: saved.email, role: saved.role, token, expiresAt },
                actingUserId
            )
        );

        this.logger.log(`Invitation created: ${saved.id}`, { invitationId: saved.id, email: saved.email });
        return invitationResponseMapper.toResponse(saved);
    }

    async findAll(query: PaginateQuery): Promise<Paginated<InvitationResponse>> {
        const baseWhere = this.tenantAware.withTenantFilter({ deletedAt: null });
        const result = await prismaPaginate(query, this.prisma.invitation, INVITATION_PAGINATE_CONFIG, baseWhere);
        return {
            data: invitationResponseMapper.toResponseArray(result.data as InvitationProps[]),
            meta: result.meta as Paginated<InvitationResponse>['meta'],
            links: result.links
        };
    }

    async resend(id: string, actingUserId: string): Promise<InvitationResponse> {
        const existing = (await this.invitation.findUnique({ where: { id } })) as InvitationProps | null;
        if (!existing) {
            throw new NotFoundException(`Invitation with ID ${id} not found`);
        }
        if (existing.status !== InvitationStatusEnum.PENDING) {
            throw new BadRequestException(`Only pending invitations can be resent (current status: ${existing.status})`);
        }

        const token = this.generateToken();
        const newExpiresAt = this.expiry();
        const updated = (await this.invitation.update({ where: { id }, data: { token, expiresAt: newExpiresAt } })) as InvitationProps;

        this.txEventEmitter.emitAfterCommit(
            'invitation.resent',
            new InvitationResentEvent(
                updated.id,
                updated.tenantId,
                {
                    invitationId: updated.id,
                    tenantId: updated.tenantId,
                    email: updated.email,
                    role: updated.role,
                    token,
                    newExpiresAt,
                    resentAt: new Date()
                },
                actingUserId
            )
        );

        this.logger.log(`Invitation resent: ${id}`, { invitationId: id, email: updated.email });
        return invitationResponseMapper.toResponse(updated);
    }

    async revoke(id: string, actingUserId: string): Promise<void> {
        const existing = (await this.invitation.findUnique({ where: { id } })) as InvitationProps | null;
        if (!existing) {
            throw new NotFoundException(`Invitation with ID ${id} not found`);
        }

        await this.invitation.update({ where: { id }, data: { status: InvitationStatusEnum.REVOKED } });
        this.logger.log(`Invitation revoked: ${id}`, { invitationId: id, revokedBy: actingUserId });
    }

    async getByToken(token: string): Promise<PublicInvitationResponse> {
        const invitation = await this.resolveRedeemable(token);
        return publicInvitationResponseMapper.toResponse(invitation);
    }

    async accept(token: string, authUser: IAuthenticatedUser): Promise<UserResponse> {
        const invitation = await this.resolveRedeemable(token);

        if (!authUser.email || authUser.email.toLowerCase() !== invitation.email.toLowerCase()) {
            throw new ForbiddenException('This invitation was issued to a different email address');
        }

        const member = await this.usersService.provisionMember({
            tenantId: invitation.tenantId,
            kratosIdentityId: authUser.userId,
            email: invitation.email,
            role: invitation.role,
            actingUserId: authUser.userId
        });

        await this.prisma.invitation.update({ where: { id: invitation.id }, data: { status: InvitationStatusEnum.ACCEPTED } });
        this.logger.log(`Invitation accepted: ${invitation.id}`, { invitationId: invitation.id, userId: member.id, tenantId: invitation.tenantId });

        return userResponseMapper.toResponse(member);
    }

    /** Load a PENDING, non-expired invitation by token (no tenant context); marks it EXPIRED on lapse. */
    private async resolveRedeemable(token: string): Promise<InvitationProps> {
        const invitation = (await this.prisma.invitation.findUnique({ where: { token } })) as InvitationProps | null;
        if (!invitation || invitation.deletedAt) {
            throw new NotFoundException('Invitation not found');
        }
        if (invitation.status !== InvitationStatusEnum.PENDING) {
            throw new BadRequestException(`Invitation is ${invitation.status.toLowerCase()}`);
        }
        if (invitation.expiresAt.getTime() < Date.now()) {
            await this.prisma.invitation.update({ where: { id: invitation.id }, data: { status: InvitationStatusEnum.EXPIRED } });
            throw new BadRequestException('Invitation has expired');
        }
        return invitation;
    }

    // --- crypto / ttl helpers ---

    private generateToken(): string {
        return randomBytes(32).toString('base64url');
    }

    private expiry(): Date {
        return new Date(Date.now() + this.INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    }
}
