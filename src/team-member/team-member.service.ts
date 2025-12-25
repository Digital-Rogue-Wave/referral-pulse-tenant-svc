import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DeleteResult, FindOptionsRelations, FindOptionsWhere } from 'typeorm';
import { TeamMemberEntity } from './team-member.entity';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NullableType } from '@mod/types/nullable.type';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { tenantMemberPaginationConfig } from './config/tenant-member-pagination-config';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { ClsService } from 'nestjs-cls';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import { RoleEnum } from '@mod/common/enums/role.enum';
import { In } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class TeamMemberService {
    constructor(
        @InjectTenantAwareRepository(TeamMemberEntity)
        private readonly teamMemberRepository: TenantAwareRepository<TeamMemberEntity>,
        private readonly eventEmitter: EventEmitter2,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    async create(createDto: CreateTeamMemberDto): Promise<TeamMemberEntity> {
        const member = this.teamMemberRepository.createTenantContext(createDto);
        return await this.teamMemberRepository.saveTenantContext(member);
    }

    async findAll(query: PaginateQuery): Promise<Paginated<TeamMemberEntity>> {
        return await this.teamMemberRepository.paginateTenantContext(query, this.teamMemberRepository, tenantMemberPaginationConfig);
    }

    async countMembers(): Promise<number> {
        return await this.teamMemberRepository.getTotalTenantContext();
    }

    async findOne(
        field: FindOptionsWhere<TeamMemberEntity>,
        relations?: FindOptionsRelations<TeamMemberEntity>
    ): Promise<NullableType<TeamMemberEntity>> {
        return this.teamMemberRepository.findOne({
            where: field,
            relations
        });
    }

    async findOneOrFail(field: FindOptionsWhere<TeamMemberEntity>, relations?: FindOptionsRelations<TeamMemberEntity>): Promise<TeamMemberEntity> {
        return this.teamMemberRepository.findOneOrFail({ where: field, relations });
    }

    async updateRole(memberId: string, updateDto: UpdateTeamMemberDto): Promise<TeamMemberEntity> {
        const member = await this.findOneOrFail({ id: memberId }, { tenant: true });

        const oldRole = member.role;
        const newRole = updateDto.role;

        // Task 57: Last admin protection
        // If downgrading from ADMIN/OWNER to MEMBER
        if ((oldRole === RoleEnum.ADMIN || oldRole === RoleEnum.OWNER) && newRole === RoleEnum.MEMBER) {
            const adminCount = await this.teamMemberRepository.getTotalTenantContext({
                role: In([RoleEnum.ADMIN, RoleEnum.OWNER])
            });

            if (adminCount <= 1) {
                throw new HttpException({ message: 'Cannot downgrade the last administrator in the tenant' }, HttpStatus.FORBIDDEN);
            }
        }

        member.role = newRole;
        const updatedMember = await this.teamMemberRepository.saveTenantContext(member);

        // Emit event for audit/Keto updates
        this.eventEmitter.emit('member.role.updated', {
            memberId: member.id,
            userId: member.userId,
            oldRole,
            newRole: updateDto.role,
            ipAddress: this.cls.get().ip,
            userAgent: this.cls.get().userAgent
        });

        return updatedMember;
    }

    async remove(memberId: string): Promise<DeleteResult> {
        const member = await this.findOneOrFail({ id: memberId }, { tenant: true });

        // Task 61: Last admin protection
        if (member.role === RoleEnum.ADMIN || member.role === RoleEnum.OWNER) {
            const adminCount = await this.teamMemberRepository.getTotalTenantContext({
                role: In([RoleEnum.ADMIN, RoleEnum.OWNER])
            });

            if (adminCount <= 1) {
                throw new BadRequestException('Cannot remove the last administrator in the tenant');
            }
        }

        // Emit event for Keto cleanup, session invalidation, and notification
        this.eventEmitter.emit('member.removed', {
            memberId: member.id,
            userId: member.userId,
            tenantId: member.tenantId,
            ipAddress: this.cls.get().ip,
            userAgent: this.cls.get().userAgent
        });

        return await this.teamMemberRepository.deleteTenantContext({ id: memberId });
    }
}
