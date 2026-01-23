import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { SideEffectService } from '@app/common/side-effects/side-effect.service';
import { HttpClientService } from '@app/common/http/http-client.service';
import { CriticalEmailEvent, MarketingEmailEvent } from '../email.events';

/**
 * Email notification handler
 * - Critical emails (email.critical.*): SQS to email service with DLQ
 * - Non-critical emails (email.marketing.*): Fire-and-forget HTTP call
 *
 * Critical emails include: password resets, receipts, verifications, account notifications
 * Non-critical emails include: marketing, newsletters, promotional content
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - DLQ provides failure recovery for critical emails
 */
@Injectable()
export class EmailNotificationListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly httpClient: HttpClientService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(EmailNotificationListener.name);
    }

    /**
     * Handle critical emails: password resets, receipts, verifications
     * Sends via SQS to email service queue (with DLQ for guaranteed delivery)
     *
     * Pattern: 'email.critical.*' matches all critical email events
     */
    @OnEvent('email.critical.*', { async: true })
    async handleCriticalEmail(event: CriticalEmailEvent): Promise<void> {
        try {
            // Send via SQS to email service queue (non-critical - direct with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'email',
                event.aggregateId,
                'email.send',
                'email-service-queue',
                {
                    to: event.to,
                    subject: event.subject,
                    body: event.body,
                    templateId: event.templateId,
                    priority: 'high',
                    metadata: {
                        eventId: event.eventId,
                        aggregateId: event.aggregateId,
                        tenantId: event.tenantId,
                        ...event.metadata,
                    },
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: `email-${event.eventId}`,
                },
            );

            this.logger.log(`Critical email sent to queue: ${event.subject}`, {
                eventId: event.eventId,
                to: event.to,
                templateId: event.templateId,
            });
        } catch (error) {
            // DLQ monitors failures
            this.logger.error(
                `Failed to send critical email (check DLQ): ${event.subject}`,
                error instanceof Error ? error.stack : undefined,
                { eventId: event.eventId, to: event.to },
            );
        }
    }

    /**
     * Handle non-critical marketing emails: newsletters, promotions, updates
     * Fire-and-forget HTTP call to email service (acceptable loss)
     *
     * Pattern: 'email.marketing.*' matches all marketing email events
     */
    @OnEvent('email.marketing.*', { async: true })
    async handleMarketingEmail(event: MarketingEmailEvent): Promise<void> {
        try {
            // Fire-and-forget HTTP call to email service
            await this.httpClient.post(
                'https://email-service/send',
                {
                    to: event.to,
                    subject: event.subject,
                    body: event.body,
                    unsubscribeLink: event.unsubscribeLink,
                    metadata: event.metadata,
                },
                { timeout: 5000 },
            );

            this.logger.debug(`Marketing email sent: ${event.subject}`, {
                eventId: event.eventId,
                to: event.to,
            });
        } catch (error) {
            // Log and ignore - acceptable for marketing emails
            this.logger.warn(
                `Marketing email failed (ignoring): ${event.subject}`,
                {
                    eventId: event.eventId,
                    to: event.to,
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            );
        }
    }
}