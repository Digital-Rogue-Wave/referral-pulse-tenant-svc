import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { SideEffectService } from '@app/common/side-effects/side-effect.service';
import { HttpClientService } from '@app/common/http/http-client.service';
import { TotoCreatedEvent } from '@app/domains/toto/events/toto.events';
import type { AllConfigType } from '@app/config/config.type';

/**
 * Tenant Service Listener
 *
 * Communication Patterns:
 * - ASYNC: SQS for usage tracking, quota updates
 * - SYNC: HTTP for quota validation, feature flag checks
 *
 * Purpose: Track tenant usage, validate quotas, check feature access,
 * and update tenant statistics.
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - DLQ provides failure recovery
 */
@Injectable()
export class TenantServiceListener {
    private readonly tenantServiceUrl: string;

    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly httpClient: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(TenantServiceListener.name);
        this.tenantServiceUrl =
            this.configService.get('services.tenant.url', { infer: true }) ||
            'http://tenant-service';
    }

    /**
     * ASYNC: Track tenant usage via SQS
     * Updates tenant usage statistics and quotas
     */
    @OnEvent('toto.created', { async: true })
    async trackTenantUsageAsync(event: TotoCreatedEvent): Promise<void> {
        try {
            // ASYNC: Send usage tracking to tenant service queue (non-critical - direct with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'tenant',
                event.tenantId,
                'user.updated',
                'tenant-usage-queue',
                {
                    tenantId: event.tenantId,
                    userId: event.userId,
                    resourceType: 'toto',
                    resourceId: event.aggregateId,
                    action: 'created',
                    timestamp: event.occurredAt,
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: `tenant-usage-${event.tenantId}-${event.aggregateId}`,
                },
            );

            this.logger.debug(`Sent usage tracking to tenant service (async SQS)`, {
                eventId: event.eventId,
                tenantId: event.tenantId,
                resourceType: 'toto',
            });
        } catch (error) {
            this.logger.warn(
                `Failed to send usage tracking to tenant service (check DLQ)`,
                {
                    eventId: event.eventId,
                    tenantId: event.tenantId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            );
        }
    }

    /**
     * SYNC: Validate tenant quota via HTTP
     * Check if tenant has reached their quota limit
     *
     * NOTE: This is an example - in practice, quota validation should happen
     * BEFORE creating the entity, not after. This is just to demonstrate sync HTTP.
     */
    @OnEvent('toto.created', { async: true })
    async validateTenantQuotaSync(event: TotoCreatedEvent): Promise<void> {
        try {
            // SYNC: HTTP call to check tenant quota
            const response = await this.httpClient.get<{
                quota: number;
                used: number;
                available: number;
            }>(`${this.tenantServiceUrl}/api/tenants/${event.tenantId}/quota`, {
                timeout: 2000,
                params: {
                    resourceType: 'toto',
                },
            });

            this.logger.debug(`Tenant quota check (sync HTTP)`, {
                tenantId: event.tenantId,
                quota: response.data.quota,
                used: response.data.used,
                available: response.data.available,
            });

            // If quota exceeded, send alert via SQS (async)
            if (response.data.available <= 0) {
                await this.sideEffectService.createSqsSideEffect(
                    'tenant',
                    event.tenantId,
                    'user.updated',
                    'tenant-alerts-queue',
                    {
                        tenantId: event.tenantId,
                        resourceType: 'toto',
                        quota: response.data.quota,
                        used: response.data.used,
                    },
                    {
                        critical: false, // Direct SQS with DLQ (after commit)
                        idempotencyKey: `tenant-quota-alert-${event.tenantId}-${event.eventId}`,
                    },
                );

                this.logger.warn(`Tenant quota exceeded`, {
                    tenantId: event.tenantId,
                    quota: response.data.quota,
                    used: response.data.used,
                });
            }
        } catch (error) {
            this.logger.warn(
                `Failed to validate tenant quota (sync HTTP)`,
                {
                    eventId: event.eventId,
                    tenantId: event.tenantId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            );
        }
    }
}