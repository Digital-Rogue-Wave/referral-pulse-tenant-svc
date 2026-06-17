import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { prismaPaginate, PaginateQuery, Paginated } from '@common/nestjs-prisma-pagination';

import {
    TeamMemberProps,
    TeamMemberRole,
    TeamMemberStatus,
    CreateTeamMemberDto,
    UpdateTeamMemberDto,
    TeamMemberResponse,
    teamMemberResponseMapper,
    TeamMemberCreatedEvent,
    TeamMemberRoleUpdatedEvent,
    TeamMemberRemovedEvent,
    TeamMemberStatusUpdatedEvent
} from '@domains/team-member';

import { TEAM_MEMBER_PAGINATE_CONFIG } from './team-member.pagination';

/**
 * Service responsible for Team Member management
 * Uses Prisma with TenantAwareService for multi-tenant data access
 */
@Injectable()
export class TeamMemberService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly tenantContext: TenantContextService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(TeamMemberService.name);
    }

    /** Tenant-scoped TeamMember delegate */
    private get teamMember() {
        return this.tenantAware.forModel(this.prisma.teamMember);
    }

    /**
     * Add a new team member to the tenant
     */
    async create(userId: string, dto: CreateTeamMemberDto): Promise<TeamMemberResponse> {
        // tenantId is guaranteed by TenantAwareService/guards
        const tenantId = this.tenantContext.getTenantId()!;

        // Check if user is already a member of this tenant
        const existing = await this.teamMember.findFirst({
            where: { userId: dto.userId }
        });

        if (existing) {
            throw new ConflictException(`User ${dto.userId} is already a member of this tenant`);
        }

        const saved = (await this.teamMember.create({
            data: {
                userId: dto.userId,
                role: dto.role,
                status: dto.status ?? TeamMemberStatus.ACTIVE
            }
        })) as TeamMemberProps;

        const event = new TeamMemberCreatedEvent(
            saved.id,
            tenantId,
            {
                memberId: saved.id,
                userId: saved.userId,
                tenantId: saved.tenantId,
                role: saved.role,
                createdAt: saved.createdAt
            },
            userId
        );
        this.txEventEmitter.emitAfterCommit('team-member.created', event);
        this.txEventEmitter.emitAfterCommit('audit.team-member.created', event);

        this.logger.log(`Team member created: ${saved.id}`, {
            memberId: saved.id,
            memberUserId: saved.userId,
            role: saved.role
        });

        return teamMemberResponseMapper.toResponse(saved);
    }

    /**
     * List all team members with pagination
     */
    async findAll(query: PaginateQuery): Promise<Paginated<TeamMemberResponse>> {
        const baseWhere = this.tenantAware.withTenantFilter({ deletedAt: null });
        const result = await prismaPaginate(query, this.prisma.teamMember, TEAM_MEMBER_PAGINATE_CONFIG, baseWhere);

        return {
            data: teamMemberResponseMapper.toResponseArray(result.data as TeamMemberProps[]),
            meta: result.meta as Paginated<TeamMemberResponse>['meta'],
            links: result.links
        };
    }

    /**
     * Get total count of team members for the tenant
     */
    async countMembers(): Promise<number> {
        return this.teamMember.count({
            where: { deletedAt: null }
        });
    }

    /**
     * Get a single team member by ID
     */
    async findById(id: string): Promise<TeamMemberResponse> {
        const member = (await this.teamMember.findUnique({
            where: { id }
        })) as TeamMemberProps | null;

        if (!member) {
            throw new NotFoundException(`Team member with ID ${id} not found`);
        }

        return teamMemberResponseMapper.toResponse(member);
    }

    /**
     * Update team member role
     */
    async updateRole(id: string, actingUserId: string, dto: UpdateTeamMemberDto): Promise<TeamMemberResponse> {
        const existing = (await this.teamMember.findUnique({
            where: { id }
        })) as TeamMemberProps | null;

        if (!existing) {
            throw new NotFoundException(`Team member with ID ${id} not found`);
        }

        const oldRole = existing.role;
        const newRole = dto.role;

        // Last admin protection: prevent downgrading the last admin/owner
        if (newRole && (oldRole === TeamMemberRole.ADMIN || oldRole === TeamMemberRole.OWNER) && newRole === TeamMemberRole.MEMBER) {
            const adminCount = await this.teamMember.count({
                where: {
                    role: { in: [TeamMemberRole.ADMIN, TeamMemberRole.OWNER] },
                    deletedAt: null
                }
            });

            if (adminCount <= 1) {
                throw new ForbiddenException('Cannot downgrade the last administrator in the tenant');
            }
        }

        const updateData: Record<string, unknown> = {};
        if (dto.role) {
            updateData.role = dto.role;
        }
        if (dto.status) {
            updateData.status = dto.status;
        }

        const updated = (await this.teamMember.update({
            where: { id },
            data: updateData
        })) as TeamMemberProps;

        // Emit role update event if role changed
        if (newRole && newRole !== oldRole) {
            const roleEvent = new TeamMemberRoleUpdatedEvent(
                id,
                updated.tenantId,
                {
                    memberId: id,
                    userId: existing.userId,
                    tenantId: updated.tenantId,
                    oldRole,
                    newRole,
                    updatedBy: actingUserId,
                    updatedAt: updated.updatedAt
                },
                actingUserId
            );
            this.txEventEmitter.emitAfterCommit('team-member.updated', roleEvent);
            this.txEventEmitter.emitAfterCommit('audit.team-member.updated', roleEvent);
        }

        // Emit status update event if status changed
        if (dto.status && dto.status !== existing.status) {
            const statusEvent = new TeamMemberStatusUpdatedEvent(
                id,
                updated.tenantId,
                {
                    memberId: id,
                    userId: existing.userId,
                    tenantId: updated.tenantId,
                    oldStatus: existing.status,
                    newStatus: dto.status,
                    updatedBy: actingUserId,
                    updatedAt: updated.updatedAt
                },
                actingUserId
            );
            this.txEventEmitter.emitAfterCommit('team-member.status', statusEvent);
            this.txEventEmitter.emitAfterCommit('audit.team-member.status', statusEvent);
        }

        this.logger.log(`Team member updated: ${id}`, {
            memberId: id,
            changes: updateData
        });

        return teamMemberResponseMapper.toResponse(updated);
    }

    /**
     * Remove a team member (soft delete)
     */
    async remove(id: string, actingUserId: string): Promise<void> {
        const existing = (await this.teamMember.findUnique({
            where: { id }
        })) as TeamMemberProps | null;

        if (!existing) {
            throw new NotFoundException(`Team member with ID ${id} not found`);
        }

        // Last admin protection
        if (existing.role === TeamMemberRole.ADMIN || existing.role === TeamMemberRole.OWNER) {
            const adminCount = await this.teamMember.count({
                where: {
                    role: { in: [TeamMemberRole.ADMIN, TeamMemberRole.OWNER] },
                    deletedAt: null
                }
            });

            if (adminCount <= 1) {
                throw new ForbiddenException('Cannot remove the last administrator in the tenant');
            }
        }

        await this.teamMember.delete({ where: { id } });

        const event = new TeamMemberRemovedEvent(
            id,
            existing.tenantId,
            {
                memberId: id,
                userId: existing.userId,
                tenantId: existing.tenantId,
                removedBy: actingUserId,
                removedAt: new Date()
            },
            actingUserId
        );
        this.txEventEmitter.emitAfterCommit('team-member.deleted', event);
        this.txEventEmitter.emitAfterCommit('audit.team-member.deleted', event);

        this.logger.log(`Team member removed: ${id}`, {
            memberId: id,
            memberUserId: existing.userId
        });
    }

    /**
     * Find a member by user ID (used for checking membership)
     */
    async findByUserId(userId: string): Promise<TeamMemberResponse | null> {
        const member = (await this.teamMember.findFirst({
            where: { userId, deletedAt: null }
        })) as TeamMemberProps | null;

        if (!member) {
            return null;
        }

        return teamMemberResponseMapper.toResponse(member);
    }
}
