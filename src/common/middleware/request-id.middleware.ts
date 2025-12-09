import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
    constructor(private readonly cls: ClsService) {}

    use(req: Request, res: Response, next: NextFunction) {
        const customId = req.headers['x-request-id'] as string | undefined;
        const albTraceId = req.headers['x-amzn-trace-id'] as string | undefined;

        let requestId: string;

        if (customId) {
            requestId = customId;
        } else if (albTraceId) {
            const rootMatch = albTraceId.match(/Root=([^;]+)/);
            requestId = rootMatch ? rootMatch[1] : randomUUID();
        } else {
            requestId = randomUUID();
        }

        // Store in CLS
        this.cls.set('requestId', requestId);

        // Store ALB trace details
        if (albTraceId) {
            const parentMatch = albTraceId.match(/Parent=([^;]+)/);
            const sampledMatch = albTraceId.match(/Sampled=([^;]+)/);

            if (parentMatch) this.cls.set('albParentId', parentMatch[1]);
            if (sampledMatch) this.cls.set('albSampled', sampledMatch[1] === '1');
        }

        // Add to request for backward compatibility
        (req as any).requestId = requestId;

        res.setHeader('x-request-id', requestId);
        if (albTraceId) {
            res.setHeader('x-amzn-trace-id', albTraceId);
        }

        next();
    }
}
