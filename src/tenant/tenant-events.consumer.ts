import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import { ClsService } from 'nestjs-cls';
import { AppLoggingService } from '@mod/common/logger/app-logging.service';
import { SqsEventHandler } from '@mod/common/aws-sqs/sqs-event-handler.decorator';
import { EventEnvelope } from '@mod/types/app.interface';
import { EventIdempotencyService } from '@mod/common/idempotency/event-idempotency.service';
import { CampaignEvents } from '@domains/commons/domain.event';

@Injectable()
export class CampaignEventsConsumer {
    constructor(
        private readonly metrics: MonitoringService,
        private readonly eventIdempotency: EventIdempotencyService,
        private readonly cls: ClsService,
        private readonly logger: AppLoggingService
    ) {}

    @SqsMessageHandler('campaign-events', false)
    @SqsEventHandler({ queue: 'campaign-events', consumerName: 'campaign-events-consumer' })
    async handleEvent(message: Message): Promise<void> {
        const envelope: EventEnvelope = JSON.parse(message.Body || '{}');
        const { metadata, payload } = envelope;

        this.logger.info(
            `Processing campaign event - eventType: ${metadata.eventType}, eventId: ${metadata.eventId}, requestId: ${metadata.requestId || 'none'}`
        );

        switch (metadata.eventType) {
            case 'campaign.created':
                await this.handleCreated(payload as CampaignEvents.Created);
                break;
            case 'campaign.updated':
                await this.handleUpdated(payload as CampaignEvents.Updated);
                break;
            case 'campaign.invitation_sent':
                await this.handleInvitationSent(payload as CampaignEvents.InvitationSent);
                break;
            case 'campaign.activated':
                await this.handleActivated(payload as CampaignEvents.Activated);
                break;
            default:
                this.logger.warn(`Unknown campaign event type: ${metadata.eventType}`);
        }
    }

    private handleCreated(payload: CampaignEvents.Created): void {
        this.logger.info(`Campaign created processed - campaignId: ${payload.campaignId}`);
        // Business logic
    }

    private handleUpdated(payload: CampaignEvents.Updated): void {
        this.logger.info(`Campaign updated processed - campaignId: ${payload.campaignId}`);
        // Business logic
    }

    private handleInvitationSent(payload: CampaignEvents.InvitationSent): void {
        this.logger.info(`Campaign invitation sent processed - campaignId: ${payload.campaignId}, invitationId: ${payload.invitationId}`);
        // Business logic
    }

    private handleActivated(payload: CampaignEvents.Activated): void {
        this.logger.info(`Campaign activated processed - campaignId: ${payload.campaignId}`);
        // Business logic
    }
}
