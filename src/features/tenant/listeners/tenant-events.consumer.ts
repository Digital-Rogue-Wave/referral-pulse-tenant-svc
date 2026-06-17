import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';

import { type IMessageEnvelope, CAMPAIGN_SVC_FIFO } from '@app/types';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { MessageProcessorService } from '@common/messaging/message-processor.service';
import { SqsConsumer } from '@common/messaging/sqs-consumer.decorator';

import { CampaignCreatedEvent, CampaignUpdatedEvent, CampaignInvitationSentEvent, CampaignActivatedEvent, CampaignEvents } from '@domains/campaign';

@Injectable()
export class CampaignEventsConsumer {
    constructor(
        private readonly messageProcessor: MessageProcessorService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(CampaignEventsConsumer.name);
    }

    @SqsConsumer({ queueName: CAMPAIGN_SVC_FIFO })
    @SqsMessageHandler(CAMPAIGN_SVC_FIFO, false)
    async handleEvent(message: Message): Promise<void> {
        await this.messageProcessor.process<IMessageEnvelope>(
            message,
            async (envelope) => {
                const { eventType, payload, messageId } = envelope;

                this.logger.log(`Processing campaign event - eventType: ${eventType}, messageId: ${messageId}`);

                switch (eventType) {
                    case CampaignEvents.CREATED:
                        this.handleCreated(payload as unknown as CampaignCreatedEvent);
                        break;
                    case CampaignEvents.UPDATED:
                        this.handleUpdated(payload as unknown as CampaignUpdatedEvent);
                        break;
                    case CampaignEvents.INVITATION_SENT:
                        this.handleInvitationSent(payload as unknown as CampaignInvitationSentEvent);
                        break;
                    case CampaignEvents.ACTIVATED:
                        this.handleActivated(payload as unknown as CampaignActivatedEvent);
                        break;
                    default:
                        this.logger.warn(`Unknown campaign event type: ${eventType}`);
                }
            },
            { queueName: CAMPAIGN_SVC_FIFO }
        );
    }

    private handleCreated(payload: CampaignCreatedEvent): void {
        this.logger.log(`Campaign created processed - campaignId: ${payload.campaignId}`);
        // TODO: handleCreated Business logic
    }

    private handleUpdated(payload: CampaignUpdatedEvent): void {
        this.logger.log(`Campaign updated processed - campaignId: ${payload.campaignId}`);
        // TODO: handleUpdated Business logic
    }

    private handleInvitationSent(payload: CampaignInvitationSentEvent): void {
        this.logger.log(`Campaign invitation sent processed - campaignId: ${payload.campaignId}, invitationId: ${payload.invitationId}`);
        // TODO: handleInvitationSent Business logic
    }

    private handleActivated(payload: CampaignActivatedEvent): void {
        this.logger.log(`Campaign activated processed - campaignId: ${payload.campaignId}`);
        // TODO: handleActivated Business logic
    }
}
