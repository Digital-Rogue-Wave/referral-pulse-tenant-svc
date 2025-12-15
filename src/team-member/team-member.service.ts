import { Injectable } from '@nestjs/common';
import { DeleteResult, FindOptionsRelations, FindOptionsWhere } from 'typeorm';
import { TeamMemberEntity } from './team-member.entity';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NullableType } from '@mod/types/nullable.type';
import { paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { tenantMemberPaginationConfig } from './config/tenant-member-pagination-config';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';

@Injectable()
export class TeamMemberService {
    constructor(
        @InjectTenantAwareRepository(TeamMemberEntity)
        private readonly teamMemberRepository: TenantAwareRepository<TeamMemberEntity>,
        private readonly eventEmitter: EventEmitter2
    ) {}

    async create(createDto: CreateTeamMemberDto): Promise<TeamMemberEntity> {
        const member = this.teamMemberRepository.createTenantContext(createDto);
        return await this.teamMemberRepository.saveTenantContext(member);
    }

    async findAll(query: PaginateQuery): Promise<Paginated<TeamMemberEntity>> {
        return await paginate(query, this.teamMemberRepository, tenantMemberPaginationConfig);
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
        member.role = updateDto.role;
        const updatedMember = await this.teamMemberRepository.saveTenantContext(member);

        // Emit event for audit/Keto updates
        this.eventEmitter.emit('member.role.updated', {
            memberId: member.id,
            userId: member.userId,
            oldRole,
            newRole: updateDto.role
        });

        return updatedMember;
    }

    async remove(memberId: string): Promise<DeleteResult> {
        const member = await this.findOneOrFail({ id: memberId }, { tenant: true });

        // Emit event for Keto cleanup
        this.eventEmitter.emit('member.removed', {
            memberId: member.id,
            userId: member.userId
        });

        return await this.teamMemberRepository.deleteTenantContext({ id: memberId });
    }
}
