import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { prismaPaginate, PaginateQuery, Paginated } from '@common/nestjs-prisma-pagination';
import { RoleEnum } from '@common/enums/role.enum';
import type { IAuthenticatedUser } from '@app/types';

import { AddUserDto, UpdateUserRoleDto, UserProps, UserResponse, userResponseMapper, UserRegisteredEvent, UserRoleChangedEvent } from '@domains/user';

import { USER_PAGINATE_CONFIG } from './users.pagination';

export interface UserMeResponse {
    userId: string;
    tenantId: string;
    email: string | null;
    name: string | null;
    roles: string[];
    scopes: string[];
}

const PRIVILEGED_ROLES: string[] = [RoleEnum.OWNER, RoleEnum.ADMIN];

/**
 * Platform users (operators) — the system of record for tenant membership + role,
 * per referralai_db_tables_per_service.md (users / roles / user_roles). Ory Kratos is
 * the credential authority; `kratos_identity_id` links the local record to the identity.
 */
@Injectable()
export class UsersService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(UsersService.name);
    }

    /** Tenant-scoped User delegate */
    private get user() {
        return this.tenantAware.forModel(this.prisma.user);
    }

    async addUser(actingUserId: string, dto: AddUserDto): Promise<UserResponse> {
        const existing = await this.user.findFirst({ where: { kratosIdentityId: dto.kratosIdentityId } });
        if (existing) {
            throw new ConflictException(`User ${dto.kratosIdentityId} is already a member of this tenant`);
        }

        const saved = (await this.user.create({
            data: { kratosIdentityId: dto.kratosIdentityId, role: dto.role, email: dto.email ?? null, name: dto.name ?? null }
        })) as UserProps;

        await this.assignRole(saved.id, saved.tenantId, dto.role, actingUserId);

        this.txEventEmitter.emitAfterCommit('user.registered', new UserRegisteredEvent(saved.id, saved.tenantId, dto.role, actingUserId));

        this.logger.log(`User added: ${saved.id}`, { userId: saved.id, role: saved.role });

        return userResponseMapper.toResponse(saved);
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
        const user = (await this.user.findUnique({ where: { id } })) as UserProps | null;
        if (!user) {
            throw new NotFoundException(`User with ID ${id} not found`);
        }
        return userResponseMapper.toResponse(user);
    }

    async updateRole(id: string, actingUserId: string, dto: UpdateUserRoleDto): Promise<UserResponse> {
        const existing = (await this.user.findUnique({ where: { id } })) as UserProps | null;
        if (!existing) {
            throw new NotFoundException(`User with ID ${id} not found`);
        }

        const oldRole = existing.role;
        const newRole = dto.role;

        if (PRIVILEGED_ROLES.includes(oldRole) && !PRIVILEGED_ROLES.includes(newRole)) {
            await this.assertNotLastPrivilegedUser();
        }

        const updated = (await this.user.update({ where: { id }, data: { role: newRole } })) as UserProps;
        await this.assignRole(id, updated.tenantId, newRole, actingUserId, true);

        if (newRole !== oldRole) {
            this.txEventEmitter.emitAfterCommit('user.role_changed', new UserRoleChangedEvent(id, updated.tenantId, oldRole, newRole, actingUserId));
        }

        this.logger.log(`User role updated: ${id}`, { userId: id, oldRole, newRole });

        return userResponseMapper.toResponse(updated);
    }

    async remove(id: string, actingUserId: string): Promise<void> {
        const existing = (await this.user.findUnique({ where: { id } })) as UserProps | null;
        if (!existing) {
            throw new NotFoundException(`User with ID ${id} not found`);
        }

        if (PRIVILEGED_ROLES.includes(existing.role)) {
            await this.assertNotLastPrivilegedUser();
        }

        await this.user.delete({ where: { id } });
        this.logger.log(`User removed: ${id}`, { userId: id, removedBy: actingUserId });
    }

    async getMe(authUser: IAuthenticatedUser): Promise<UserMeResponse> {
        const record = await this.prisma.user.findUnique({
            where: { tenantId_kratosIdentityId: { tenantId: authUser.tenantId, kratosIdentityId: authUser.userId } },
            include: { userRoles: { include: { role: true } } }
        });

        const roles = record?.userRoles.map((ur) => ur.role.name) ?? [];
        const scopes = [...new Set(record?.userRoles.flatMap((ur) => (ur.role.scopes as string[]) ?? []) ?? [])];

        return {
            userId: authUser.userId,
            tenantId: authUser.tenantId,
            email: record?.email ?? authUser.email ?? null,
            name: record?.name ?? null,
            roles,
            scopes
        };
    }

    /** Prevent removing/downgrading the last Owner/Admin in a tenant. */
    private async assertNotLastPrivilegedUser(): Promise<void> {
        const privilegedCount = await this.user.count({ where: { role: { in: PRIVILEGED_ROLES }, deletedAt: null } });
        if (privilegedCount <= 1) {
            throw new ForbiddenException('Cannot remove or downgrade the last Owner/Admin in the tenant');
        }
    }

    /** Maintain the user_roles assignment join, replacing the prior role on change. */
    private async assignRole(userId: string, tenantId: string, roleName: string, assignedBy?: string, replace = false): Promise<void> {
        const role = await this.prisma.role.findUnique({ where: { name: roleName }, select: { id: true } });
        if (!role) {
            this.logger.warn(`Role "${roleName}" not found — skipping user_roles assignment (run the seed)`);
            return;
        }
        if (replace) {
            await this.prisma.userRole.deleteMany({ where: { userId } });
        }
        await this.prisma.userRole.upsert({
            where: { userId_roleId: { userId, roleId: role.id } },
            update: { assignedBy },
            create: { userId, roleId: role.id, tenantId, assignedBy }
        });
    }
}
