import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AUDIT_TRAIL_FIFO } from '@app/types';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { SideEffectService } from '@common/side-effects/side-effect.service';

import { ApiKeyCreatedEvent, ApiKeyUpdatedEvent, ApiKeyStatusUpdatedEvent, ApiKeyDeletedEvent, ApiKeyEvents } from '@domains/api-key';

/**
 * Listener for API Key domain events
 * Handles side effects like audit logging via the SideEffectService
 */
@Injectable()
export class ApiKeyListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(ApiKeyListener.name);
    }

    @OnEvent('api-key.created')
    async handleApiKeyCreated(event: ApiKeyCreatedEvent): Promise<void> {
        this.logger.log(`API key created: ${event.payload.apiKeyId}`, {
            apiKeyId: event.payload.apiKeyId,
            name: event.payload.name
        });

        // Send audit trail event (non-critical)
        await this.sideEffectService.createSqsSideEffect(
            'api-key',
            event.payload.apiKeyId,
            ApiKeyEvents.CREATED,
            AUDIT_TRAIL_FIFO,
            {
                action: 'API_KEY_CREATED',
                tenantId: event.tenantId,
                userId: event.userId,
                apiKeyId: event.payload.apiKeyId,
                name: event.payload.name,
                keyPrefix: event.payload.keyPrefix,
                scopes: event.payload.scopes,
                timestamp: event.occurredAt
            },
            { critical: false }
        );
    }

    @OnEvent('api-key.updated')
    async handleApiKeyUpdated(event: ApiKeyUpdatedEvent): Promise<void> {
        this.logger.log(`API key updated: ${event.payload.apiKeyId}`, {
            apiKeyId: event.payload.apiKeyId,
            changes: event.payload.changes
        });

        await this.sideEffectService.createSqsSideEffect(
            'api-key',
            event.payload.apiKeyId,
            ApiKeyEvents.UPDATED,
            AUDIT_TRAIL_FIFO,
            {
                action: 'API_KEY_UPDATED',
                tenantId: event.tenantId,
                userId: event.userId,
                apiKeyId: event.payload.apiKeyId,
                changes: event.payload.changes,
                timestamp: event.occurredAt
            },
            { critical: false }
        );
    }

    @OnEvent('api-key.status')
    async handleApiKeyStatusUpdated(event: ApiKeyStatusUpdatedEvent): Promise<void> {
        this.logger.log(`API key status updated: ${event.payload.apiKeyId}`, {
            apiKeyId: event.payload.apiKeyId,
            previousStatus: event.payload.previousStatus,
            newStatus: event.payload.newStatus
        });

        await this.sideEffectService.createSqsSideEffect(
            'api-key',
            event.payload.apiKeyId,
            ApiKeyEvents.STATUS,
            AUDIT_TRAIL_FIFO,
            {
                action: event.payload.newStatus === 'stopped' ? 'API_KEY_STOPPED' : 'API_KEY_STATUS_UPDATED',
                tenantId: event.tenantId,
                userId: event.userId,
                apiKeyId: event.payload.apiKeyId,
                previousStatus: event.payload.previousStatus,
                newStatus: event.payload.newStatus,
                timestamp: event.occurredAt
            },
            { critical: false }
        );
    }

    @OnEvent('api-key.deleted')
    async handleApiKeyDeleted(event: ApiKeyDeletedEvent): Promise<void> {
        this.logger.log(`API key deleted: ${event.payload.apiKeyId}`, {
            apiKeyId: event.payload.apiKeyId,
            keyName: event.payload.keyName
        });

        await this.sideEffectService.createSqsSideEffect(
            'api-key',
            event.payload.apiKeyId,
            ApiKeyEvents.DELETED,
            AUDIT_TRAIL_FIFO,
            {
                action: 'API_KEY_DELETED',
                tenantId: event.tenantId,
                userId: event.userId,
                apiKeyId: event.payload.apiKeyId,
                keyName: event.payload.keyName,
                keyPrefix: event.payload.keyPrefix,
                timestamp: event.occurredAt
            },
            { critical: false }
        );
    }
}
