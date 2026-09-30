import { Module, Global } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { EmailNotificationListener } from './listeners/email-notification.listener';
import { KetoSyncListener } from './listeners/keto-sync.listener';
import { EventOutboxRelayWorker } from './outbox/event-outbox-relay.worker';
import { EventOutboxWriter } from './outbox/event-outbox.writer';
import { TransactionEventEmitterService } from './transaction-event-emitter.service';

/**
 * Global Events Module for Event-Driven Side Effects
 *
 * Provides EventEmitter2 for clean separation between business logic and side effects.
 * Events are emitted AFTER database transaction commits to prevent phantom events.
 *
 * Architecture:
 * - Business logic: Just emit domain events after DB operations
 * - Event listeners: Handle all side effects (cross-service, analytics, audit)
 * - Hybrid approach: Critical ops use outbox, non-critical use direct SQS + events
 *
 * Published events: EventOutboxWriter records them in `event_outbox` (inside the state change's
 * transaction); EventOutboxRelayWorker publishes them to SNS `tenant-events`.
 *
 * Infrastructure Listeners:
 * - EmailNotificationListener: Critical emails (SQS) + marketing (HTTP)
 *
 * Note: Metrics are recorded at the actual operation sites (MessagingMetricsService,
 * HttpMetricsService) rather than via event listeners to avoid misleading correlations.
 *
 * Communication Patterns:
 * - ASYNC: SQS for event-driven workflows (most common)
 * - SYNC: HTTP for immediate queries/validations (when needed)
 *
 * Usage:
 *   @Transactional()
 *   async create(dto) {
 *     const saved = await repo.save(entity);
 *     this.txEventEmitter.emitAfterCommit('entity.created', new EntityCreatedEvent(...));
 *   }
 */
@Global()
@Module({
    imports: [
        EventEmitterModule.forRoot({
            wildcard: true, // Enable wildcard listeners (e.g., 'user.*', '**')
            delimiter: '.', // Event namespace delimiter
            newListener: false,
            removeListener: false,
            maxListeners: 20, // Max listeners per event
            verboseMemoryLeak: true,
            ignoreErrors: false // Errors in listeners are handled by listeners themselves
        })
    ],
    providers: [
        TransactionEventEmitterService,

        // Domain events → event_outbox (in the state change's transaction) → SNS tenant-events
        EventOutboxWriter,
        EventOutboxRelayWorker,

        // Infrastructure listeners
        EmailNotificationListener, // Email service (critical SQS + marketing HTTP)
        KetoSyncListener // Membership → Ory Keto, through the outbox
    ],
    exports: [EventEmitterModule, TransactionEventEmitterService]
})
export class EventsModule {}
