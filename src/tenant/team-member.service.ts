import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, FindOptionsRelations, FindOptionsWhere, Repository } from 'typeorm';
import { TeamMemberEntity } from './team-member.entity';
import { UpdateTeamMemberDto } from './dto/team-member/update-team-member.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NullableType } from '@mod/types/nullable.type';

@Injectable()
export class TeamMemberService {
    constructor(
        @InjectRepository(TeamMemberEntity)
        private readonly teamMemberRepository: Repository<TeamMemberEntity>,
        private readonly eventEmitter: EventEmitter2
    ) {}

    async findAll(options?: FindManyOptions<TeamMemberEntity>): Promise<TeamMemberEntity[]> {
        return await this.teamMemberRepository.find(options);
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

    async updateRole(tenantId: string, memberId: string, updateDto: UpdateTeamMemberDto): Promise<TeamMemberEntity> {
        const member = await this.findOneOrFail({ id: memberId, tenant: { id: tenantId } }, { tenant: true });

        const oldRole = member.role;
        member.role = updateDto.role;
        const updatedMember = await this.teamMemberRepository.save(member);

        // Emit event for audit/Keto updates
        this.eventEmitter.emit('member.role.updated', {
            memberId: member.id,
            userId: member.userId,
            tenantId,
            oldRole,
            newRole: updateDto.role
        });

        return updatedMember;
    }

    async remove(tenantId: string, memberId: string): Promise<TeamMemberEntity> {
        const member = await this.findOneOrFail({ id: memberId, tenant: { id: tenantId } }, { tenant: true });

        // Emit event for Keto cleanup
        this.eventEmitter.emit('member.removed', {
            memberId: member.id,
            userId: member.userId,
            tenantId
        });

        return await this.teamMemberRepository.remove(member);
    }
}
