import { HttpStatus, Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { BaseException } from '@common/exceptions/base.exceptions';
import { sha256Hex } from '@common/helper/hashing';
import { RoleEnum } from '@common/enums/role.enum';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { cursorPage, CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';
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
import { UserInvitedEvent, UserResponse, userResponseMapper } from '@domains/user';

import { UsersService } from '@app/features/users/users.service';
import { RoleGrantPolicy } from '@app/features/users/role-grant.policy';
import { PlanLimitService } from '@app/features/billing/plan-limit.service';

/**
 * Tenant member invitations (sanctioned extension — not in the canonical API contract; see NOTE.md).
 * Admin side is tenant-scoped (create/list/resend/revoke); acceptance is token-based and reuses the
 * invitee's own Ory identity (Kratos owns credentials) to provision the membership.
 *
 * Only a SHA-256 of the token is stored; the token itself exists only in the invitee's email link.
 * The inviter's rank bounds the role they can invite at (RoleGrantPolicy), and acceptance is atomic: the
 * invitation is claimed PENDING→ACCEPTED in the same transaction that creates the membership.
 */
@Injectable()
export class InvitationService {
    private readonly INVITATION_TTL_DAYS = 7;

    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly usersService: UsersService,
        private readonly planLimits: PlanLimitService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(InvitationService.name);
    }

    /** Tenant-scoped Invitation delegate */
    private get invitation() {
        return this.tenantAware.forModel(this.prisma.invitation);
    }

    async create(actor: IAuthenticatedUser, dto: CreateInvitationDto): Promise<InvitationResponse> {
        RoleGrantPolicy.assertCanGrant(await this.usersService.roleOf(actor), dto.role);
        const actingUserId = actor.userId;
        const existing = await this.invitation.findFirst({ where: { email: dto.email, status: InvitationStatusEnum.PENDING } });
        if (existing) {
            throw new ConflictException(`A pending invitation already exists for ${dto.email}`);
        }
        // A pending invitation holds a seat, so accepting it later never exceeds the plan.
        await this.planLimits.assertSeatAvailable(actor.tenantId);

        const token = this.generateToken();
        const expiresAt = this.expiry();

        const saved = await this.prisma.$transaction(async (tx) => {
            const created = (await tx.invitation.create({
                data: {
                    tenantId: actor.tenantId,
                    email: dto.email,
                    role: dto.role,
                    status: InvitationStatusEnum.PENDING,
                    tokenHash: sha256Hex(token),
                    expiresAt
                }
            })) as InvitationProps;
            // The invitation email needs the raw token, so this in-process event carries it; it is never published.
            this.txEventEmitter.emitAfterCommit(
                'invitation.created',
                new InvitationCreatedEvent(
                    created.id,
                    created.tenantId,
                    { invitationId: created.id, tenantId: created.tenantId, email: created.email, role: created.role, token, expiresAt },
                    actingUserId
                )
            );
            this.txEventEmitter.emitAfterCommit('user.invited', new UserInvitedEvent(created.id, created.tenantId, created.role, actingUserId));
            return created;
        });

        this.logger.log(`Invitation created: ${saved.id}`, { invitationId: saved.id });
        return invitationResponseMapper.toResponse(saved);
    }

    async findAll(query: ListQueryDto): Promise<CursorPage<InvitationResponse>> {
        return cursorPage(this.prisma.invitation, this.tenantAware.withTenantFilter({ deletedAt: null }), query, (row) =>
            invitationResponseMapper.toResponse(row as InvitationProps)
        );
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
        const updated = (await this.invitation.update({
            where: { id },
            data: { tokenHash: sha256Hex(token), expiresAt: newExpiresAt }
        })) as InvitationProps;

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

        this.logger.log(`Invitation resent: ${id}`, { invitationId: id });
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

    /**
     * Accepts an invitation for the signed-in identity. The address is taken from Ory (the credential
     * authority) and must match the invitation; the claim and the membership commit together, so the same
     * invitation can never be redeemed twice.
     */
    async accept(token: string, authUser: IAuthenticatedUser): Promise<UserResponse> {
        const invitation = await this.resolveRedeemable(token);
        if (!authUser.identityId) {
            throw new BaseException('authentication_error', 'A signed-in user is required', HttpStatus.UNAUTHORIZED);
        }
        const identity = await this.usersService.identityOf(authUser.identityId);
        if (identity.email.toLowerCase() !== invitation.email.toLowerCase()) {
            throw new BaseException('authorization_error', 'This invitation was issued to a different email address', HttpStatus.FORBIDDEN);
        }

        const member = await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.invitation.updateMany({
                where: { id: invitation.id, status: InvitationStatusEnum.PENDING },
                data: { status: InvitationStatusEnum.ACCEPTED }
            });
            if (claimed.count === 0) {
                throw new BaseException('state_conflict', 'This invitation has already been used', HttpStatus.CONFLICT);
            }
            return this.usersService.joinByInvitation(tx, invitation.tenantId, identity, invitation.role as RoleEnum, null);
        });

        this.logger.log(`Invitation accepted: ${invitation.id}`, { invitationId: invitation.id, userId: member.id, tenantId: invitation.tenantId });
        return userResponseMapper.toResponse(member);
    }

    /** Load a PENDING, non-expired invitation by token (no tenant context); marks it EXPIRED on lapse. */
    private async resolveRedeemable(token: string): Promise<InvitationProps> {
        const invitation = (await this.prisma.invitation.findUnique({ where: { tokenHash: sha256Hex(token) } })) as InvitationProps | null;
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
