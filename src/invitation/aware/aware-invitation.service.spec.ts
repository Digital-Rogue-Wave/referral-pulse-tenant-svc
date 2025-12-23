import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { AwareInvitationService } from './aware-invitation.service';
import { InvitationEntity } from '../invitation.entity';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';
import { AwareTenantService } from '@mod/tenant/aware/aware-tenant.service';
import { RoleEnum } from '@mod/common/enums/role.enum';
import { TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import Stubber from '@mod/common/mock/typeorm-faker';
import { TenantEntity } from '@mod/tenant/tenant.entity';

describe('AwareInvitationService', () => {
    let service: AwareInvitationService;
    let invitationRepository: DeepMocked<TenantAwareRepository<InvitationEntity>>;
    let tenantService: DeepMocked<AwareTenantService>;
    let eventEmitter: DeepMocked<EventEmitter2>;
    let configService: DeepMocked<ConfigService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AwareInvitationService,
                {
                    provide: 'TenantAwareRepository_InvitationEntity',
                    useValue: createMock<TenantAwareRepository<InvitationEntity>>()
                },
                {
                    provide: AwareTenantService,
                    useValue: createMock<AwareTenantService>()
                },
                {
                    provide: EventEmitter2,
                    useValue: createMock<EventEmitter2>()
                },
                {
                    provide: ConfigService,
                    useValue: createMock<ConfigService>()
                }
            ]
        }).compile();

        service = module.get<AwareInvitationService>(AwareInvitationService);
        invitationRepository = module.get('TenantAwareRepository_InvitationEntity');
        tenantService = module.get(AwareTenantService);
        eventEmitter = module.get(EventEmitter2);
        configService = module.get(ConfigService);

        configService.getOrThrow.mockReturnValue(7 as never);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        it('should create an invitation and emit events', async () => {
            const dto = { email: 'test@example.com', role: RoleEnum.MEMBER };
            const savedInvitation = Stubber.stubOne(InvitationEntity, {
                id: 'inv-123',
                email: dto.email,
                role: dto.role,
                tenantId: 'tenant-123',
                token: 'token-123',
                status: InvitationStatusEnum.PENDING,
                expiresAt: new Date()
            });
            const tenant = Stubber.stubOne(TenantEntity, { id: 'tenant-123', name: 'Test Tenant' });

            invitationRepository.createTenantContext.mockReturnValue(savedInvitation);
            invitationRepository.saveTenantContext.mockResolvedValue(savedInvitation);
            tenantService.findOneOrFail.mockResolvedValue(tenant);

            const result = await service.create(dto);

            expect(result).toEqual(savedInvitation);
            expect(invitationRepository.createTenantContext).toHaveBeenCalled();
            expect(invitationRepository.saveTenantContext).toHaveBeenCalled();
            expect(eventEmitter.emit).toHaveBeenCalledWith('invitation.created', expect.any(Object));
            expect(eventEmitter.emit).toHaveBeenCalledWith('member.invited', expect.any(Object));
        });
    });

    describe('resend', () => {
        it('should renew expiry and re-emit events', async () => {
            const invitationId = 'inv-123';
            const existingInvitation = Stubber.stubOne(InvitationEntity, {
                id: invitationId,
                email: 'test@example.com',
                tenantId: 'tenant-123',
                status: InvitationStatusEnum.PENDING,
                token: 'token-123',
                expiresAt: new Date(Date.now() - 1000) // expired
            });
            const tenant = Stubber.stubOne(TenantEntity, { id: 'tenant-123', name: 'Test Tenant' });

            invitationRepository.findOneOrFailTenantContext.mockResolvedValue(existingInvitation);
            tenantService.findOneOrFail.mockResolvedValue(tenant);
            invitationRepository.saveTenantContext.mockResolvedValue(
                Stubber.stubOne(InvitationEntity, { ...existingInvitation, status: InvitationStatusEnum.PENDING })
            );

            const result = await service.resend(invitationId);

            expect(result.status).toBe(InvitationStatusEnum.PENDING);
            expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
            expect(eventEmitter.emit).toHaveBeenCalledWith('invitation.created', expect.any(Object));
        });

        it('should throw error if invitation is not pending or expired', async () => {
            const invitationId = 'inv-123';
            const acceptedInvitation = Stubber.stubOne(InvitationEntity, {
                id: invitationId,
                status: InvitationStatusEnum.ACCEPTED
            });

            invitationRepository.findOneOrFailTenantContext.mockResolvedValue(acceptedInvitation);

            await expect(service.resend(invitationId)).rejects.toThrow('Only pending or expired invitations can be resent');
        });
    });

    describe('revoke', () => {
        it('should revoke a pending invitation', async () => {
            const invitationId = 'inv-123';
            const invitation = Stubber.stubOne(InvitationEntity, { id: invitationId, status: InvitationStatusEnum.PENDING });

            invitationRepository.findOneOrFailTenantContext.mockResolvedValue(invitation);

            await service.revoke(invitationId);

            expect(invitation.status).toBe(InvitationStatusEnum.REVOKED);
            expect(invitationRepository.saveTenantContext).toHaveBeenCalledWith(invitation);
        });
    });
});
