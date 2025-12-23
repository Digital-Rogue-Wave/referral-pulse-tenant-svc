import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
    constructor(private readonly cls: ClsService) {}

    use(req: Request, res: Response, next: NextFunction) {
        const tenantIdHeader = req.headers['tenant-id'] as string;

        // If tenantId is already set (e.g. by ApiKeyMiddleware), and header is missing, keep current
        const currentTenantId = this.cls.get('tenantId');
        const finalTenantId = tenantIdHeader || currentTenantId;

        // Ensure context is available
        this.cls.run(() => {
            if (finalTenantId) {
                this.cls.set('tenantId', finalTenantId);
            }
            next();
        });
    }
}
