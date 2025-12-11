import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
    constructor(private readonly cls: ClsService) {}

    use(req: Request, res: Response, next: NextFunction) {
        const tenantId = req.headers['tenant-id'] as string;
        // Ensure context is available
        this.cls.run(() => {
            this.cls.set('tenantId', tenantId);
            next();
        });
    }
}
