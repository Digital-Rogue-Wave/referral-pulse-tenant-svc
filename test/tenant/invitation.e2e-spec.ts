import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType, HttpStatus, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { AgnosticInvitationService } from '@mod/invitation/agnostic/agnostic-invitation.service';
import { AgnosticInvitationController } from '@mod/invitation/agnostic/agnostic-invitation.controller';
import { InvitationEntity } from '@mod/invitation/invitation.entity';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';
import { TeamMemberService } from '@mod/team-member/team-member.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsModule } from 'nestjs-cls';
import { AutomapperModule } from '@automapper/nestjs';
import { classes } from '@automapper/classes';
import { InvitationSerializationProfile } from '@mod/invitation/serialization/invitation-serialization.profile';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';

describe('Invitation acceptance (Integration)', () => {
    let app: INestApplication;
    let invitationRepository: any;
    let teamMemberService: DeepMocked<TeamMemberService>;

    const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        identityId: 'user-123',
        sub: 'user-123'
    };

    const mockInvitation = {
        id: 'inv-123',
        token: 'valid-token',
        email: 'test@example.com',
        tenantId: 'tenant-123',
        role: 'MEMBER',
        status: InvitationStatusEnum.PENDING,
        expiresAt: new Date(Date.now() + 86400000)
    } as any as InvitationEntity;

    class MockGuard implements CanActivate {
        canActivate(context: ExecutionContext): boolean {
            const req = context.switchToHttp().getRequest();
            req.user = mockUser;
            return true;
        }
    }

    beforeEach(async () => {
        invitationRepository = createMock();
        teamMemberService = createMock<TeamMemberService>();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [ClsModule.forRoot({ global: true }), AutomapperModule.forRoot({ strategyInitializer: classes() })],
            controllers: [AgnosticInvitationController],
            providers: [
                AgnosticInvitationService,
                InvitationSerializationProfile,
                { provide: getRepositoryToken(InvitationEntity), useValue: invitationRepository },
                { provide: TeamMemberService, useValue: teamMemberService },
                { provide: EventEmitter2, useValue: createMock<EventEmitter2>() },
                { provide: ConfigService, useValue: createMock<ConfigService>() }
            ]
        })
            .overrideGuard(JwtAuthGuard)
            .useClass(MockGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api');
        app.enableVersioning({ type: VersioningType.URI });
        await app.init();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    describe('GET /api/v1/invitations/public/invites/:token/validate', () => {
        it('should validate a pending invitation', async () => {
            invitationRepository.findOneOrFail.mockResolvedValue(mockInvitation);

            const response = await request(app.getHttpServer()).get('/api/v1/invitations/public/invites/valid-token/validate').expect(HttpStatus.OK);

            expect(response.body.token).toBe('valid-token');
        });

        it('should fail if invitation is expired', async () => {
            const expiredInvitation = { ...mockInvitation, expiresAt: new Date(Date.now() - 1000) };
            invitationRepository.findOneOrFail.mockResolvedValue(expiredInvitation);

            await request(app.getHttpServer()).get('/api/v1/invitations/public/invites/valid-token/validate').expect(HttpStatus.BAD_REQUEST);
        });
    });

    describe('PUT /api/v1/invitations/public/invites?action=accept', () => {
        it('should accept a pending invitation and create a member', async () => {
            invitationRepository.findOneOrFail.mockResolvedValue(mockInvitation);
            invitationRepository.save.mockResolvedValue({ ...mockInvitation, status: InvitationStatusEnum.ACCEPTED });

            const response = await request(app.getHttpServer())
                .put('/api/v1/invitations/public/invites?action=accept')
                .send({ token: 'valid-token' })
                .expect(HttpStatus.OK);

            expect(response.body.status).toBe(InvitationStatusEnum.ACCEPTED);
            expect(teamMemberService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: mockUser.id,
                    tenantId: mockInvitation.tenantId,
                    status: 'active'
                })
            );
        });
    });
});
