import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditService } from '@mod/common/audit/audit.service';
import { AuditAction } from '@mod/common/audit/audit-action.enum';
import { ApiKeyStatusEnum } from '@mod/common/enums/api-key.enum';
import {
    ApiKeyCreatedEvent,
    ApiKeyDeletedEvent,
    ApiKeyStatusUpdatedEvent,
    ApiKeyUpdatedEvent
} from '@mod/common/interfaces/api-key-events.interface';

@Injectable()
export class ApiKeyListener {
    constructor(private readonly auditService: AuditService) {}

    @OnEvent('api-key.created')
    async handleApiKeyCreatedEvent(payload: ApiKeyCreatedEvent) {
        const { apiKey, userId, ipAddress, userAgent } = payload;

        await this.auditService.log({
            tenantId: apiKey.tenantId,
            userId,
            action: AuditAction.API_KEY_CREATED,
            description: `API key "${apiKey.name}" created`,
            metadata: {
                apiKeyId: apiKey.id,
                keyPrefix: apiKey.keyPrefix,
                scopes: apiKey.scopes
            },
            ipAddress,
            userAgent
        });
    }

    @OnEvent('api-key.updated')
    async handleApiKeyUpdatedEvent(payload: ApiKeyUpdatedEvent) {
        const { apiKey, changes, userId, ipAddress, userAgent } = payload;

        await this.auditService.log({
            tenantId: apiKey.tenantId,
            userId,
            action: AuditAction.API_KEY_UPDATED,
            description: `API key "${apiKey.name}" updated`,
            metadata: {
                apiKeyId: apiKey.id,
                changes: changes
            },
            ipAddress,
            userAgent
        });
    }

    @OnEvent('api-key.status.updated')
    async handleApiKeyStatusUpdatedEvent(payload: ApiKeyStatusUpdatedEvent) {
        const { apiKey, previousStatus, newStatus, userId, ipAddress, userAgent } = payload;

        // Determine audit action
        const auditAction = newStatus === ApiKeyStatusEnum.STOPPED ? AuditAction.API_KEY_STOPPED : AuditAction.API_KEY_UPDATED;

        await this.auditService.log({
            tenantId: apiKey.tenantId,
            userId,
            action: auditAction,
            description: `API key "${apiKey.name}" status changed from ${previousStatus} to ${newStatus}`,
            metadata: {
                apiKeyId: apiKey.id,
                previousStatus,
                newStatus
            },
            ipAddress,
            userAgent
        });
    }

    @OnEvent('api-key.deleted')
    async handleApiKeyDeletedEvent(payload: ApiKeyDeletedEvent) {
        const { apiKeyId, tenantId, keyName, keyPrefix, userId, ipAddress, userAgent } = payload;

        await this.auditService.log({
            tenantId,
            userId,
            action: AuditAction.API_KEY_DELETED,
            description: `API key "${keyName}" deleted`,
            metadata: {
                apiKeyId,
                keyPrefix
            },
            ipAddress,
            userAgent
        });
    }
}
