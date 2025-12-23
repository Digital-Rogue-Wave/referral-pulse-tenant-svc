import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvitationProcessor } from './invitation.processor';
import { InvitationEntity } from '../invitation.entity';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';
import { INVITATION_EXPIRY_JOB } from '@mod/common/bullmq/queues/invitation.queue';
import { createMock, DeepMocked } from '@golevelup/ts-jest';

describe('InvitationProcessor', () => {
    let processor: InvitationProcessor;
    let invitationRepository: DeepMocked<Repository<InvitationEntity>>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                InvitationProcessor,
                {
                    provide: getRepositoryToken(InvitationEntity),
                    useValue: createMock<Repository<InvitationEntity>>()
                }
            ]
        }).compile();

        processor = module.get<InvitationProcessor>(InvitationProcessor);
        invitationRepository = module.get(getRepositoryToken(InvitationEntity));
    });

    it('should be defined', () => {
        expect(processor).toBeDefined();
    });

    describe('handleExpiryCheck', () => {
        it('should mark expired invitations as EXPIRED', async () => {
            const expiredInvitation = {
                id: '1',
                status: InvitationStatusEnum.PENDING,
                expiresAt: new Date(Date.now() - 1000)
            } as InvitationEntity;

            invitationRepository.find.mockResolvedValue([expiredInvitation]);
            invitationRepository.save.mockResolvedValue([expiredInvitation] as any);

            await (processor as any).handleExpiryCheck();

            expect(expiredInvitation.status).toBe(InvitationStatusEnum.EXPIRED);
            expect(invitationRepository.save).toHaveBeenCalled();
        });

        it('should do nothing if no expired invitations found', async () => {
            invitationRepository.find.mockResolvedValue([]);

            await (processor as any).handleExpiryCheck();

            expect(invitationRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('process', () => {
        it('should call handleExpiryCheck if job name matches', async () => {
            const spy = jest.spyOn(processor as any, 'handleExpiryCheck').mockResolvedValue(undefined);
            const job = { name: INVITATION_EXPIRY_JOB } as any;

            await processor.process(job);

            expect(spy).toHaveBeenCalled();
        });
    });
});
