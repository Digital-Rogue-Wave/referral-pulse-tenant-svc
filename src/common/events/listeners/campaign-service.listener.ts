import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { SideEffectService } from '@app/common/side-effects/side-effect.service';
import { HttpClientService } from '@app/common/http/http-client.service';
import { TotoCreatedEvent, TotoUpdatedEvent } from '@app/domains/toto/events/toto.events';
import type { AllConfigType } from '@app/config/config.type';

/**
 * Campaign Service Listener
 *
 * Communication Patterns:
 * - ASYNC: SQS for event notifications (campaign triggers, stats updates)
 * - SYNC: HTTP for immediate queries (get campaign status, validate)
 *
 * Purpose: Notify campaign service about events that may trigger campaigns,
 * update campaign statistics, or require campaign validation.
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - DLQ provides failure recovery
 */
@Injectable()
export class CampaignServiceListener {
    private readonly campaignServiceUrl: string;

    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly httpClient: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(CampaignServiceListener.name);
        this.campaignServiceUrl =
            this.configService.get('services.campaign.url', { infer: true }) ||
            'http://campaign-service';
    }

    /**
     * ASYNC: Send toto.created event to campaign service via SQS
     * Campaign service may trigger automated campaigns based on this event
     */
    @OnEvent('toto.created', { async: true })
    async handleTotoCreatedAsync(event: TotoCreatedEvent): Promise<void> {
        try {
            // ASYNC: Send to campaign service queue (non-critical - direct with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'campaign',
                event.aggregateId,
                'campaign.created',
                'campaign-events-queue',
                {
                    totoId: event.aggregateId,
                    name: event.name,
                    status: event.status,
                    tenantId: event.tenantId,
                    createdAt: event.occurredAt,
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: `campaign-toto-created-${event.aggregateId}`,
                },
            );

            this.logger.debug(`Sent toto.created to campaign service (async SQS)`, {
                eventId: event.eventId,
                totoId: event.aggregateId,
            });
        } catch (error) {
            this.logger.error(
                `Failed to send toto.created to campaign service (check DLQ)`,
                error instanceof Error ? error.stack : undefined,
                { eventId: event.eventId },
            );
        }
    }

    /**
     * SYNC: Query campaign service for active campaigns (HTTP)
     * Example: Check if toto update should trigger campaign notification
     */
    @OnEvent('toto.updated', { async: true })
    async handleTotoUpdatedSync(event: TotoUpdatedEvent): Promise<void> {
        try {
            // SYNC: HTTP call to check active campaigns for this toto
            const response = await this.httpClient.get<{ campaigns: any[] }>(
                `${this.campaignServiceUrl}/api/campaigns/active`,
                {
                    timeout: 3000,
                    params: {
                        tenantId: event.tenantId,
                        entityType: 'toto',
                        entityId: event.aggregateId,
                    },
                },
            );

            if (response.data.campaigns.length > 0) {
                // ASYNC: If there are active campaigns, send update via SQS
                await this.sideEffectService.createSqsSideEffect(
                    'campaign',
                    event.aggregateId,
                    'campaign.updated',
                    'campaign-events-queue',
                    {
                        totoId: event.aggregateId,
                        changes: event.changes,
                        tenantId: event.tenantId,
                        campaigns: response.data.campaigns.map((c) => c.id),
                    },
                    {
                        critical: false, // Direct SQS with DLQ (after commit)
                        idempotencyKey: `campaign-toto-updated-${event.aggregateId}-${event.eventId}`,
                    },
                );

                this.logger.log(
                    `Toto update triggers ${response.data.campaigns.length} campaigns`,
                    {
                        totoId: event.aggregateId,
                        campaigns: response.data.campaigns.length,
                    },
                );
            }
        } catch (error) {
            this.logger.warn(
                `Failed to query campaign service for toto.updated`,
                {
                    eventId: event.eventId,
                    totoId: event.aggregateId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            );
        }
    }
}