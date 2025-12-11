import { JwtPayload } from './app.interface';

declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
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

        // Passport.js also uses Express.User
        type User = JwtPayload;
    }
}
