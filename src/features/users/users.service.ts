import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { KratosService } from '@common/auth/kratos.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { hashEmail } from '@common/helper/hashing';
import { prismaPaginate, PaginateQuery, Paginated } from '@common/nestjs-prisma-pagination';
import { RoleEnum } from '@common/enums/role.enum';
import type { IAuthenticatedUser } from '@app/types';

import {
    AddUserDto,
    UpdateUserRoleDto,
    UserProps,
    UserResponse,
    userResponseMapper,
    UserRegisteredEvent,
    UserRemovedEvent,
    UserRoleChangedEvent
} from '@domains/user';

import { RoleGrantPolicy } from './role-grant.policy';
import { USER_PAGINATE_CONFIG } from './users.pagination';

export interface UserMeResponse {
    userId: string;
    tenantId: string;
    email: string | null;
    name: string | null;
    role: string | null;
    permissions: string[];
}

/** The identity being made a member — always read from Ory, never from a request body. */
export interface MemberIdentity {
    identityId: string;
    email: string;
    name?: string | null;
}

const PRIVILEGED_ROLES: RoleEnum[] = [RoleEnum.OWNER, RoleEnum.ADMIN];

/**
 * Tenant membership: who belongs to which tenant, with which role.
 *
 * `users` + `user_roles` are the write model; every change emits a domain event after commit, and
 * KetoSyncListener mirrors it into Ory Keto through the outbox (the Keto reconciler repairs any gap).
 * Ory Kratos owns credentials; one identity belongs to exactly one tenant (DB Model v2 §3).
 */
@Injectable()
export class UsersService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly kratos: KratosService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(UsersService.name);
    }

    /** Tenant-scoped User delegate */
    private get user() {
        return this.tenantAware.forModel(this.prisma.user);
    }

    /** Adds an existing Ory identity to the caller's tenant. */
    async addUser(actor: IAuthenticatedUser, dto: AddUserDto): Promise<UserResponse> {
        RoleGrantPolicy.assertCanGrant(await this.roleOf(actor), dto.role);
        const identity = await this.identityOf(dto.kratosIdentityId);

        const member = await this.prisma.$transaction((tx) =>
            this.createMembership(tx, { tenantId: actor.tenantId, identity, role: dto.role, assignedBy: actor.userId })
        );
        return userResponseMapper.toResponse(member);
    }

    /** Creates the Owner membership of a brand-new tenant, inside the tenant-creation transaction. */
    async createOwner(tx: Prisma.TransactionClient, tenantId: string, identity: MemberIdentity): Promise<UserProps> {
        return this.createMembership(tx, { tenantId, identity, role: RoleEnum.OWNER, assignedBy: null });
    }

    /** Invitation acceptance: the invitation fixed the tenant and role; the inviter's grant was checked at invite time. */
    async joinByInvitation(
        tx: Prisma.TransactionClient,
        tenantId: string,
        identity: MemberIdentity,
        role: RoleEnum,
        invitedBy: string | null
    ): Promise<UserProps> {
        return this.createMembership(tx, { tenantId, identity, role, assignedBy: invitedBy });
    }

    async findAll(query: PaginateQuery): Promise<Paginated<UserResponse>> {
        const baseWhere = this.tenantAware.withTenantFilter({ deletedAt: null });
        const result = await prismaPaginate(query, this.prisma.user, USER_PAGINATE_CONFIG, baseWhere);

        return {
            data: userResponseMapper.toResponseArray(result.data as UserProps[]),
            meta: result.meta as Paginated<UserResponse>['meta'],
            links: result.links
        };
    }

    async findById(id: string): Promise<UserResponse> {
        return userResponseMapper.toResponse(await this.findMember(id));
    }

    async updateRole(actor: IAuthenticatedUser, id: string, dto: UpdateUserRoleDto): Promise<UserResponse> {
        const actorRole = await this.roleOf(actor);
        const target = await this.findMember(id);
        RoleGrantPolicy.assertCanManage(actorRole, actor.userId, { id: target.id, role: target.role as RoleEnum });
        RoleGrantPolicy.assertCanGrant(actorRole, dto.role);
        if (target.role === dto.role) {
            return userResponseMapper.toResponse(target);
        }
        if (PRIVILEGED_ROLES.includes(target.role as RoleEnum) && !PRIVILEGED_ROLES.includes(dto.role)) {
            await this.assertNotLastPrivilegedUser(target.tenantId);
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            const saved = (await tx.user.update({ where: { id }, data: { role: dto.role } })) as UserProps;
            await this.replaceRoleProjection(tx, saved, dto.role, actor.userId);
            this.txEventEmitter.emitAfterCommit(
                'user.role_changed',
                new UserRoleChangedEvent(id, saved.tenantId, target.role, dto.role, actor.userId)
            );
            return saved;
        });

        this.logger.log('User role updated', { userId: id, oldRole: target.role, newRole: dto.role });
        return userResponseMapper.toResponse(updated);
    }

    /**
     * Removes a member: the row is soft-deleted, the role projection cleared, the Keto membership revoked
     * (via the event) and every Ory session of the identity ended, so access stops now rather than at the
     * next token refresh.
     */
    async remove(actor: IAuthenticatedUser, id: string): Promise<void> {
        const actorRole = await this.roleOf(actor);
        const target = await this.findMember(id);
        RoleGrantPolicy.assertCanManage(actorRole, actor.userId, { id: target.id, role: target.role as RoleEnum });
        if (target.role === RoleEnum.OWNER) {
            throw new BaseException('state_conflict', 'Transfer ownership before removing the Owner', HttpStatus.CONFLICT);
        }
        if (PRIVILEGED_ROLES.includes(target.role as RoleEnum)) {
            await this.assertNotLastPrivilegedUser(target.tenantId);
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.user.update({ where: { id }, data: { deletedAt: new Date() } });
            await tx.userRole.deleteMany({ where: { userId: id } });
            this.txEventEmitter.emitAfterCommit('user.removed', new UserRemovedEvent(id, target.tenantId, target.role, actor.userId));
        });

        await this.kratos.revokeSessions(target.kratosIdentityId).catch((error: unknown) => {
            this.logger.warn('Could not revoke the removed user’s Ory sessions', {
                userId: id,
                reason: error instanceof Error ? error.message : 'unknown'
            });
        });
        this.logger.log('User removed', { userId: id, removedBy: actor.userId });
    }

    /**
     * The Owner hands the tenant to another member. The new Owner is promoted and the previous Owner
     * becomes an Admin, atomically — a tenant always has exactly one Owner.
     */
    async transferOwnership(actor: IAuthenticatedUser, newOwnerId: string): Promise<void> {
        if ((await this.roleOf(actor)) !== RoleEnum.OWNER) {
            throw new BaseException('insufficient_permissions', 'Only the Owner can transfer ownership', HttpStatus.FORBIDDEN);
        }
        const target = await this.findMember(newOwnerId);
        if (target.id === actor.userId) {
            throw new BaseException('invalid_request', 'You already own this tenant', HttpStatus.BAD_REQUEST);
        }

        await this.prisma.$transaction(async (tx) => {
            const promoted = (await tx.user.update({ where: { id: target.id }, data: { role: RoleEnum.OWNER } })) as UserProps;
            const demoted = (await tx.user.update({ where: { id: actor.userId }, data: { role: RoleEnum.ADMIN } })) as UserProps;
            await this.replaceRoleProjection(tx, promoted, RoleEnum.OWNER, actor.userId);
            await this.replaceRoleProjection(tx, demoted, RoleEnum.ADMIN, actor.userId);
            this.txEventEmitter.emitAfterCommit(
                'user.role_changed',
                new UserRoleChangedEvent(promoted.id, promoted.tenantId, target.role, RoleEnum.OWNER, actor.userId)
            );
            this.txEventEmitter.emitAfterCommit(
                'user.role_changed',
                new UserRoleChangedEvent(demoted.id, demoted.tenantId, RoleEnum.OWNER, RoleEnum.ADMIN, actor.userId)
            );
        });
        this.logger.log('Tenant ownership transferred', { tenantId: actor.tenantId, from: actor.userId, to: target.id });
    }

    async getMe(authUser: IAuthenticatedUser): Promise<UserMeResponse> {
        const record = await this.prisma.user.findFirst({ where: { id: authUser.userId, tenantId: authUser.tenantId, deletedAt: null } });
        return {
            userId: authUser.userId,
            tenantId: authUser.tenantId,
            email: record?.email ?? null,
            name: record?.name ?? null,
            role: record?.role ?? null,
            permissions: authUser.perms ?? []
        };
    }

    /** The acting user's role, read from the membership — the JWT carries permissions, not the role. */
    async roleOf(actor: IAuthenticatedUser): Promise<RoleEnum> {
        const record = await this.prisma.user.findFirst({
            where: { id: actor.userId, tenantId: actor.tenantId, deletedAt: null },
            select: { role: true }
        });
        if (!record) {
            throw new BaseException('insufficient_permissions', 'You are not a member of this tenant', HttpStatus.FORBIDDEN);
        }
        return record.role as RoleEnum;
    }

    /** Reads the identity's email and name from Ory Kratos (the credential authority). */
    async identityOf(identityId: string): Promise<MemberIdentity> {
        const identity = await this.kratos.getIdentity(identityId);
        const email = identity.traits?.email;
        if (!email) {
            throw new BaseException('invalid_request', 'The identity has no email address', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const name = [identity.traits.firstname, identity.traits.lastname].filter(Boolean).join(' ') || null;
        return { identityId: identity.id, email, name };
    }

    private async createMembership(
        tx: Prisma.TransactionClient,
        input: { tenantId: string; identity: MemberIdentity; role: RoleEnum; assignedBy: string | null }
    ): Promise<UserProps> {
        const existing = await tx.user.findUnique({ where: { kratosIdentityId: input.identity.identityId } });
        if (existing && !existing.deletedAt) {
            throw new BaseException('duplicate_resource', 'This identity already belongs to a tenant', HttpStatus.CONFLICT);
        }
        if (existing) {
            // A removed membership frees the identity; the old row is history only, so it is replaced.
            await tx.user.delete({ where: { id: existing.id } });
        }

        const saved = (await tx.user.create({
            data: {
                tenantId: input.tenantId,
                kratosIdentityId: input.identity.identityId,
                email: input.identity.email,
                emailHash: hashEmail(input.identity.email),
                name: input.identity.name ?? null,
                role: input.role
            }
        })) as UserProps;
        await this.replaceRoleProjection(tx, saved, input.role, input.assignedBy);

        this.txEventEmitter.emitAfterCommit(
            'user.registered',
            new UserRegisteredEvent(saved.id, saved.tenantId, input.role, input.assignedBy ?? saved.id)
        );
        this.logger.log('Member provisioned', { userId: saved.id, tenantId: saved.tenantId, role: input.role });
        return saved;
    }

    private async findMember(id: string): Promise<UserProps> {
        const user = (await this.user.findFirst({ where: { id, deletedAt: null } })) as UserProps | null;
        if (!user) {
            throw new BaseException('resource_not_found', `User ${id} not found`, HttpStatus.NOT_FOUND);
        }
        return user;
    }

    /** Prevent removing/downgrading the last Owner/Admin in a tenant. */
    private async assertNotLastPrivilegedUser(tenantId: string): Promise<void> {
        const privilegedCount = await this.prisma.user.count({ where: { tenantId, role: { in: PRIVILEGED_ROLES }, deletedAt: null } });
        if (privilegedCount <= 1) {
            throw new BaseException('state_conflict', 'Cannot remove or downgrade the last Owner/Admin in the tenant', HttpStatus.CONFLICT);
        }
    }

    /** The `user_roles` display projection (DB Model v2 §3) — one row per member, replaced on change. */
    private async replaceRoleProjection(tx: Prisma.TransactionClient, user: UserProps, roleName: RoleEnum, assignedBy: string | null): Promise<void> {
        const role = await tx.role.findUnique({ where: { name: roleName }, select: { id: true } });
        if (!role) {
            throw new BaseException('internal_error', `Role catalog is missing ${roleName} — run the seed`, HttpStatus.INTERNAL_SERVER_ERROR);
        }
        await tx.userRole.deleteMany({ where: { userId: user.id } });
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id, tenantId: user.tenantId, assignedBy } });
    }
}
