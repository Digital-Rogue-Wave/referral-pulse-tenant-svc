import { Request as ExpressRequest } from 'express';

declare global {
    namespace Express {
        interface Request {
            tenantId?: string;
            tenantInfo?: any;
            apiKeyId?: string;
            apiKeyScopes?: string[];
            rateLimits?: any;
            quotas?: any;
            correlationId?: string;
            requestId?: string;
            idempotencyKey?: string;
        }
    }
}
