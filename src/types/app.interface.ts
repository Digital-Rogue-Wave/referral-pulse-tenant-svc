import { MaybeType } from '@mod/types/maybe.type';
import type { InternalAxiosRequestConfig } from 'axios';

export abstract class TenantContext {
    abstract getTenantId(): MaybeType<string>;
}

export abstract class ServiceAuthProvider {
    abstract getHeaders(audience: string, tenantId?: string): Promise<Record<string, string>>;
}

export interface TimedAxiosRequestConfig extends InternalAxiosRequestConfig {
    __start?: bigint;
}

export interface CachedResponse {
    statusCode: number;
    body: any;
}

export interface JwtPayload {
    sub: string; // user ID or client ID (for M2M)
    tenant_id?: string;
    aud: string | string[];
    iss: string;
    exp: number;
    iat: number;

    // User tokens (from frontend flow)
    email: string;
    email_verified?: boolean;

    // Service tokens (M2M client credentials)
    client_id?: string;
    grant_type?: string; // 'client_credentials' for M2M

    // Custom extensions
    ext?: {
        tenant_id?: string;
        user_id?: string;
        [key: string]: unknown;
    };
}

export interface KetoPermission {
    namespace: string;
    relation: string;
    object?: string;
    objectParam?: string;
    allowServiceTokens?: boolean; // Allow M2M tokens to bypass check
}

export interface KratosIdentity {
    id: string;
    schema_id: string;
    traits: Record<string, any>;
    metadata_public?: Record<string, any>;
}

export interface EventMetadata {
    eventId: string;
    eventType: string;
    tenantId: string;
    userId?: string;
    requestId?: string;
    correlationId?: string;
    replyTo?: string;
    causationId?: string;
    timestamp: string;
    version: string;
}

export interface EventEnvelope<TPayload = unknown> {
    metadata: EventMetadata;
    payload: TPayload;
}
