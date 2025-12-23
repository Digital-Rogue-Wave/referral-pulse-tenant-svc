import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { INVITATION_QUEUE, INVITATION_EXPIRY_JOB } from '@mod/common/bullmq/queues/invitation.queue';

@Injectable()
export class InvitationQueueService implements OnModuleInit {
    private readonly logger = new Logger(InvitationQueueService.name);

    constructor(@InjectQueue(INVITATION_QUEUE) private readonly invitationQueue: Queue) {}

    async onModuleInit() {
        await this.scheduleRepeatableJobs();
    }

    private async scheduleRepeatableJobs() {
        this.logger.log('Scheduling repeatable jobs for invitation queue...');

        // Check for expired invitations every hour
        await this.invitationQueue.add(
            INVITATION_EXPIRY_JOB,
            {},
            {
                repeat: {
                    pattern: '0 * * * *' // Every hour at minute 0
                },
                jobId: INVITATION_EXPIRY_JOB // Use fixed jobId for repeatability
            }
        );

        this.logger.log('Repeatable jobs scheduled.');
    }
}
