import { ApiKeyEntity } from '@mod/api-key/api-key.entity';
import { ApiKeyStatusEnum } from '@mod/common/enums/api-key.enum';
import { UpdateApiKeyDto } from '@mod/api-key/dto/update-api-key.dto';

export interface ApiKeyCreatedEvent {
    apiKey: ApiKeyEntity;
    userId: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface ApiKeyUpdatedEvent {
    apiKey: ApiKeyEntity;
    changes: UpdateApiKeyDto;
    userId: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface ApiKeyStatusUpdatedEvent {
    apiKey: ApiKeyEntity;
    previousStatus: ApiKeyStatusEnum;
    newStatus: ApiKeyStatusEnum;
    userId: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface ApiKeyDeletedEvent {
    apiKeyId: string;
    tenantId: string;
    keyName: string;
    keyPrefix: string;
    userId: string;
    ipAddress?: string;
    userAgent?: string;
}
