import 'express';

declare global {
    namespace Express {
        interface Request {
            tenantId?: string;
            userId?: string;
            requestId?: string;
            correlationId?: string;
            idempotencyKey?: string;
            rawBody?: Buffer;
            user?: {
                sub: string;
                tenantId: string;
                email?: string;
                roles?: string[];
                permissions?: string[];
                iat?: number;
                exp?: number;
                [key: string]: unknown;
            };
        }
    }
}

export {};
