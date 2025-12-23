import { Injectable, HttpStatus, HttpException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, FindOptionsWhere, Repository } from 'typeorm';
import { InvitationEntity } from '../invitation.entity';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';
import { NullableType } from '@mod/types/nullable.type';
import { Utils } from '@mod/common/utils/utils';
import { CreateTeamMemberDto } from '@mod/team-member/dto/create-team-member.dto';
import { TeamMemberService } from '@mod/team-member/team-member.service';
import { TeamMemberStatusEnum } from '@mod/common/enums/team-member-status.enum';

@Injectable()
export class AgnosticInvitationService {
    constructor(
        @InjectRepository(InvitationEntity)
        private readonly invitationRepository: Repository<InvitationEntity>,
        private readonly teamMemberService: TeamMemberService,
        private readonly eventEmitter: EventEmitter2
    ) {}

    async findOne(
        field: FindOptionsWhere<InvitationEntity>,
        relations?: FindOptionsRelations<InvitationEntity>
    ): Promise<NullableType<InvitationEntity>> {
        return this.invitationRepository.findOne({
            where: field,
            relations
        });
    }

    async findOneOrFail(field: FindOptionsWhere<InvitationEntity>, relations?: FindOptionsRelations<InvitationEntity>): Promise<InvitationEntity> {
        return this.invitationRepository.findOneOrFail({ where: field, relations });
    }

    async accept(token: string, userId: string): Promise<InvitationEntity> {
        const invitation = await this.findOneOrFail({ token });

        if (invitation.status !== InvitationStatusEnum.PENDING) {
            throw new HttpException({ message: 'Invitation is not pending', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }

        if (invitation.expiresAt < new Date()) {
            invitation.status = InvitationStatusEnum.EXPIRED;
            await this.invitationRepository.save(invitation);
            throw new HttpException({ message: 'Invitation expired', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }

        // 1. Update invitation status
        invitation.status = InvitationStatusEnum.ACCEPTED;
        await this.invitationRepository.save(invitation);

        // 2. Update TeamMember status (Create as ACTIVE)
        const createTeamMemberDto = await Utils.validateDtoOrFail(CreateTeamMemberDto, {
            userId,
            tenantId: invitation.tenantId,
            role: invitation.role,
            status: TeamMemberStatusEnum.ACTIVE
        });

        await this.teamMemberService.create(createTeamMemberDto);

        // Emit member joined event
        this.eventEmitter.emit('member.joined', {
            userId,
            tenantId: invitation.tenantId,
            role: invitation.role,
            invitationId: invitation.id
        });
        return invitation;
    }

    async reject(token: string): Promise<InvitationEntity> {
        const invitation = await this.findOneOrFail({ token });

        if (invitation.status !== InvitationStatusEnum.PENDING) {
            throw new HttpException({ message: 'Invitation is not pending', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }

        invitation.status = InvitationStatusEnum.REJECTED;
        await this.invitationRepository.save(invitation);

        return invitation;
    }

    async validate(token: string): Promise<InvitationEntity> {
        const invitation = await this.findOneOrFail({ token });
        if (invitation.status !== InvitationStatusEnum.PENDING || invitation.expiresAt < new Date()) {
            throw new HttpException({ message: 'Invitation invalid or expired', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }
        return invitation;
    }
}
