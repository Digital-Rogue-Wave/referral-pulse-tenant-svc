import { Injectable, HttpStatus, HttpException, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { FindOptionsRelations, FindOptionsWhere } from 'typeorm';
import { InvitationEntity } from '../invitation.entity';
import { CreateInvitationDto } from '../dto/create-invitation.dto';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';

import { randomBytes } from 'crypto';
import { Utils } from '@mod/common/utils/utils';
import { CreateFullInvitationDto } from '../dto/create-full-invitation.dto';
import { AllConfigType } from '@mod/config/config.type';
import { NullableType } from '@mod/types/nullable.type';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { invitationPaginationConfig } from '../config/invitation-pagination-config';
import { AwareTenantService } from '@mod/tenant/aware/aware-tenant.service';

@Injectable()
export class AwareInvitationService {
    constructor(
        @InjectTenantAwareRepository(InvitationEntity)
        private readonly invitationRepository: TenantAwareRepository<InvitationEntity>,
        @Inject(forwardRef(() => AwareTenantService))
        private readonly tenantService: AwareTenantService,
        private readonly eventEmitter: EventEmitter2,
        private readonly configService: ConfigService<AllConfigType>
    ) {}

    async create(createInvitationDto: CreateInvitationDto): Promise<InvitationEntity> {
        const token = randomBytes(32).toString('hex');
        const expiryDays = this.configService.getOrThrow('appConfig.invitationExpiryDays', { infer: true });
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiryDays);

        // Create/validate all invitation domains
        const createFullInvitationDto = await Utils.validateDtoOrFail(CreateFullInvitationDto, {
            ...createInvitationDto,
            token,
            expiresAt,
            status: InvitationStatusEnum.PENDING
        });

        // Use tenant-aware repository to create
        const invitation = this.invitationRepository.createTenantContext(createFullInvitationDto);
        const savedInvitation = await this.invitationRepository.saveTenantContext(invitation);

        // Load tenant name for email/SNS
        const tenant = await this.tenantService.findOneOrFail({ id: savedInvitation.tenantId });

        // Emit invitation created event
        this.eventEmitter.emit('invitation.created', {
            invitationId: savedInvitation.id,
            email: createInvitationDto.email,
            token,
            tenantId: savedInvitation.tenantId,
            tenantName: tenant.name
        });

        // Emit member.invited event
        this.eventEmitter.emit('member.invited', {
            invitationId: savedInvitation.id,
            email: createInvitationDto.email,
            tenantId: savedInvitation.tenantId,
            role: createInvitationDto.role,
            expiresAt: expiresAt.toISOString()
        });

        return savedInvitation;
    }

    async findAll(query: PaginateQuery): Promise<Paginated<InvitationEntity>> {
        return await this.invitationRepository.paginateTenantContext(query, this.invitationRepository, invitationPaginationConfig);
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

    async resend(id: string): Promise<InvitationEntity> {
        const invitation = await this.findOneOrFail({ id });

        if (invitation.status !== InvitationStatusEnum.PENDING && invitation.status !== InvitationStatusEnum.EXPIRED) {
            throw new HttpException(
                { message: 'Only pending or expired invitations can be resent', code: HttpStatus.BAD_REQUEST },
                HttpStatus.BAD_REQUEST
            );
        }

        // Renew expiry
        const expiryDays = this.configService.getOrThrow('appConfig.invitationExpiryDays', { infer: true });
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiryDays);
        invitation.expiresAt = expiresAt;
        invitation.status = InvitationStatusEnum.PENDING;

        await this.invitationRepository.saveTenantContext(invitation);

        const tenant = await this.tenantService.findOneOrFail({ id: invitation.tenantId });

        // Re-emit invitation created event (sends email)
        this.eventEmitter.emit('invitation.created', {
            invitationId: invitation.id,
            email: invitation.email,
            token: invitation.token,
            tenantId: invitation.tenantId,
            tenantName: tenant.name
        });

        return invitation;
    }
}
