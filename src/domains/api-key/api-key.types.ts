/**
 * API Key domain types matching the Prisma model
 */

/**
 * API Key Props - matches Prisma ApiKey model
 */
export type ApiKeyProps = {
    id: string;
    tenantId: string;
    name: string;
    keyHash: string;
    keyPrefix: string;
    status: string;
    scopes: string[];
    createdBy: string;
    lastUsedAt: Date | null;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};

/**
 * API Key status values
 */
export const ApiKeyStatus = {
    ACTIVE: 'active',
    STOPPED: 'stopped',
} as const;

export type ApiKeyStatusType = (typeof ApiKeyStatus)[keyof typeof ApiKeyStatus];

/**
 * Event payloads for API Key events
 */
export type ApiKeyCreatedPayload = {
    apiKeyId: string;
    tenantId: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    createdBy: string;
    createdAt: Date;
};

export type ApiKeyUpdatedPayload = {
    apiKeyId: string;
    tenantId: string;
    changes: Record<string, { from: unknown; to: unknown }>;
    updatedBy: string;
    updatedAt: Date;
};

export type ApiKeyStatusUpdatedPayload = {
    apiKeyId: string;
    tenantId: string;
    previousStatus: string;
    newStatus: string;
    updatedBy: string;
    updatedAt: Date;
};

export type ApiKeyDeletedPayload = {
    apiKeyId: string;
    tenantId: string;
    keyName: string;
    keyPrefix: string;
    deletedBy: string;
    deletedAt: Date;
};
