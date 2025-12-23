import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { InvitationEntity } from '../invitation.entity';
import { InvitationStatusEnum } from '@mod/common/enums/invitation.enum';
import { INVITATION_QUEUE, INVITATION_EXPIRY_JOB } from '@mod/common/bullmq/queues/invitation.queue';

@Processor(INVITATION_QUEUE)
@Injectable()
export class InvitationProcessor extends WorkerHost {
    private readonly logger = new Logger(InvitationProcessor.name);

    constructor(
        @InjectRepository(InvitationEntity)
        private readonly invitationRepository: Repository<InvitationEntity>
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        switch (job.name) {
            case INVITATION_EXPIRY_JOB:
                return await this.handleExpiryCheck();
            default:
                this.logger.warn(`Unknown job name: ${job.name}`);
        }
    }

    private async handleExpiryCheck() {
        this.logger.log('Checking for expired invitations...');

        const expiredInvitations = await this.invitationRepository.find({
            where: {
                status: InvitationStatusEnum.PENDING,
                expiresAt: LessThan(new Date())
            }
        });

        if (expiredInvitations.length === 0) {
            this.logger.log('No expired invitations found.');
            return;
        }

        this.logger.log(`Found ${expiredInvitations.length} expired invitations. Updating status...`);

        for (const invitation of expiredInvitations) {
            invitation.status = InvitationStatusEnum.EXPIRED;
        }

        await this.invitationRepository.save(expiredInvitations);

        this.logger.log('Successfully updated expired invitations.');
    }

    @OnWorkerEvent('completed')
    onCompleted(job: Job) {
        this.logger.log(`Job ${job.id} of type ${job.name} completed.`);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, error: Error) {
        this.logger.error(`Job ${job.id} of type ${job.name} failed: ${error.message}`, error.stack);
    }
}
