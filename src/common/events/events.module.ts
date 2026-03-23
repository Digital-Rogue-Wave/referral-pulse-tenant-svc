import { Module, Global } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { AuditTrailListener } from './listeners/audit-trail.listener';
import { BroadcastEventListener } from './listeners/broadcast-event.listener';
import { CampaignServiceListener } from './listeners/campaign-service.listener';
import { EmailNotificationListener } from './listeners/email-notification.listener';
import { ReferralServiceListener } from './listeners/referral-service.listener';
import { RewardServiceListener } from './listeners/reward-service.listener';
import { TenantServiceListener } from './listeners/tenant-service.listener';
import { TrackingServiceListener } from './listeners/tracking-service.listener';
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
 * Service-Specific Listeners (Microservice Communication):
 * - TrackingServiceListener: Analytics/BI via SQS (async)
 * - CampaignServiceListener: Campaign triggers via SQS (async) + HTTP (sync)
 * - TenantServiceListener: Quota/usage tracking via SQS (async) + HTTP (sync)
 * - RewardServiceListener: Reward calculations via SQS (async)
 * - ReferralServiceListener: Referral tracking via SQS (async)
 *
 * Infrastructure Listeners:
 * - AuditTrailListener: Send all events to audit service (SQS + DLQ)
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

        // Service-specific listeners (microservice communication)
        TrackingServiceListener, // Analytics/BI (async SQS)
        CampaignServiceListener, // Campaign service (async SQS + sync HTTP)
        TenantServiceListener, // Tenant/quota service (async SQS + sync HTTP)
        RewardServiceListener, // Reward service (async SQS)
        ReferralServiceListener, // Referral service (async SQS)

        // Infrastructure listeners
        AuditTrailListener, // Audit trail service (async SQS)
        BroadcastEventListener, // Cross-service broadcast (fire-and-forget + DLQ)
        EmailNotificationListener // Email service (critical SQS + marketing HTTP)
    ],
    exports: [EventEmitterModule, TransactionEventEmitterService]
})
export class EventsModule {}
