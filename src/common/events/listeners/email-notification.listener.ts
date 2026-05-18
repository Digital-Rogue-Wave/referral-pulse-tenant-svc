import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { NOTIFICATION_WEBHOOK_SVC_FIFO, EmailSqsEvents } from '@app/types';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { SideEffectService } from '@common/side-effects/side-effect.service';

import { EmailEvent } from '@domains/common/events';
import { InvitationCreatedEvent, InvitationResentEvent } from '@domains/invitation';

/**
 * Email Notification Listener
 *
 * Communication Pattern: ASYNC only (SQS)
 * Handles all email events via a single queue.
 *
 * IMPORTANT: All external calls MUST be async via SideEffectService.
 * Never make synchronous HTTP calls from event listeners.
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - DLQ provides failure recovery
 */
@Injectable()
export class EmailNotificationListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly redisKeyBuilder: RedisKeyBuilder,
    ) {
        this.logger.setContext(EmailNotificationListener.name);
    }

    /**
     * ASYNC: Handle email events via SQS
     * Email service handles the actual sending.
     */
    @OnEvent('email.*', { async: true })
    async handleEmail(event: EmailEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'email',
                event.aggregateId,
                EmailSqsEvents.SEND,
                NOTIFICATION_WEBHOOK_SVC_FIFO,
                {
                    to: event.to,
                    subject: event.subject,
                    body: event.body,
                    templateId: event.templateId,
                    unsubscribeLink: event.unsubscribeLink,
                    metadata: {
                        eventId: event.eventId,
                        aggregateId: event.aggregateId,
                        tenantId: event.tenantId,
                        ...event.metadata,
                    },
                },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(`email-${event.eventId}`),
                },
            );

            this.logger.log(`Email queued: ${event.subject}`, {
                eventId: event.eventId,
                to: event.to,
            });
        } catch (error) {
            this.logger.error(
                `Failed to queue email (check DLQ): ${event.subject}`,
                error instanceof Error ? error.stack : undefined,
                {
                    eventId: event.eventId,
                    to: event.to,
                },
            );
        }
    }

    /**
     * ASYNC: Handle invitation created - send invitation email
     */
    @OnEvent('invitation.created', { async: true })
    async handleInvitationCreated(event: InvitationCreatedEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'invitation',
                event.aggregateId,
                EmailSqsEvents.SEND,
                NOTIFICATION_WEBHOOK_SVC_FIFO,
                {
                    to: event.payload.email,
                    templateId: 'invitation-email',
                    templateData: {
                        invitationToken: event.payload.token,
                        tenantId: event.payload.tenantId,
                        role: event.payload.role,
                        expiresAt: event.payload.expiresAt,
                    },
                    metadata: {
                        eventId: event.eventId,
                        aggregateId: event.aggregateId,
                        tenantId: event.tenantId,
                    },
                },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(`invitation-email-${event.aggregateId}`),
                },
            );

            this.logger.log(`Invitation email queued: ${event.payload.email}`, {
                invitationId: event.aggregateId,
                email: event.payload.email,
            });
        } catch (error) {
            this.logger.error(
                `Failed to queue invitation email: ${event.payload.email}`,
                error instanceof Error ? error.stack : undefined,
                {
                    invitationId: event.aggregateId,
                },
            );
        }
    }

    /**
     * ASYNC: Handle invitation resent - send new invitation email
     */
    @OnEvent('invitation.resent', { async: true })
    async handleInvitationResent(event: InvitationResentEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'invitation',
                event.aggregateId,
                EmailSqsEvents.SEND,
                NOTIFICATION_WEBHOOK_SVC_FIFO,
                {
                    to: event.payload.email,
                    templateId: 'invitation-resent-email',
                    templateData: {
                        tenantId: event.payload.tenantId,
                        newExpiresAt: event.payload.newExpiresAt,
                    },
                    metadata: {
                        eventId: event.eventId,
                        aggregateId: event.aggregateId,
                        tenantId: event.tenantId,
                    },
                },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(
                        `invitation-resent-email-${event.aggregateId}-${event.payload.resentAt.getTime()}`,
                    ),
                },
            );

            this.logger.log(`Invitation resent email queued: ${event.payload.email}`, {
                invitationId: event.aggregateId,
                email: event.payload.email,
            });
        } catch (error) {
            this.logger.error(
                `Failed to queue invitation resent email`,
                error instanceof Error ? error.stack : undefined,
                {
                    invitationId: event.aggregateId,
                },
            );
        }
    }
}
