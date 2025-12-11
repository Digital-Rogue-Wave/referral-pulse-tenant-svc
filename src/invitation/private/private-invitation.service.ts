import { Injectable, HttpStatus, HttpException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { FindOptionsRelations, FindOptionsWhere } from 'typeorm';
import { InvitationEntity } from '../invitation.entity';
import { CreateInvitationDto } from '../dto/create-invitation.dto';
import { InvitationStatusEnum } from '../../common/enums/invitation.enum';

import { randomBytes } from 'crypto';
import { TenantService } from '@mod/tenant/tenant.service';
import { Utils } from '@mod/common/utils/utils';
import { CreateFullInvitationDto } from '../dto/create-full-invitation.dto';
import { AllConfigType } from '@mod/config/config.type';
import { NullableType } from '@mod/types/nullable.type';

@Injectable()
export class PrivateInvitationService {
    constructor(
        @InjectTenantAwareRepository(InvitationEntity)
        private readonly invitationRepository: TenantAwareRepository<InvitationEntity>,
        private readonly tenantService: TenantService,
        private readonly eventEmitter: EventEmitter2,
        private readonly configService: ConfigService<AllConfigType>
    ) {}

    async create(tenantId: string, createInvitationDto: CreateInvitationDto): Promise<InvitationEntity> {
        // Ensure tenant exists (and user has access, handled by guard/controller)
        const tenant = await this.tenantService.findOneOrFail({ id: tenantId });
        const token = randomBytes(32).toString('hex');
        const expiryDays = this.configService.getOrThrow('appConfig.invitationExpiryDays', { infer: true });
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiryDays);

        // Calculate fields
        const createFullInvitationDto = await Utils.validateDtoOrFail(CreateFullInvitationDto, {
            ...createInvitationDto,
            tenant,
            token,
            expiresAt,
            status: InvitationStatusEnum.PENDING
        });

        // Use tenant-aware repository to create
        const invitation = this.invitationRepository.createTenantContext(createFullInvitationDto);
        const savedInvitation = await this.invitationRepository.saveTenantContext(invitation);

        // Emit invitation created event
        this.eventEmitter.emit('invitation.created', {
            invitationId: savedInvitation.id,
            email: createInvitationDto.email,
            token,
            tenantName: tenant.name
        });

        return savedInvitation;
    }

    async findOne(
        field: FindOptionsWhere<InvitationEntity>,
        relations?: FindOptionsRelations<InvitationEntity>
    ): Promise<NullableType<InvitationEntity>> {
        return this.invitationRepository.findOneTenantContext(field, relations);
    }

    async findOneOrFail(field: FindOptionsWhere<InvitationEntity>): Promise<InvitationEntity> {
        return this.invitationRepository.findOneOrFailTenantContext(field);
    }

    async revoke(id: string): Promise<void> {
        const invitation = await this.findOneOrFail({ id });

        if (invitation.status !== InvitationStatusEnum.PENDING) {
            throw new HttpException({ message: 'Invitation is not pending', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }

        invitation.status = InvitationStatusEnum.REVOKED;
        await this.invitationRepository.saveTenantContext(invitation);
    }
}
