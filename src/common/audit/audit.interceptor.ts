import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AuditService } from './audit.service';
import { AuditAction } from './audit-action.enum';
import { AUDIT_ACTION_KEY } from './audit.decorator';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
    constructor(
        private readonly reflector: Reflector,
        private readonly auditService: AuditService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const action = this.reflector.get<AuditAction>(AUDIT_ACTION_KEY, context.getHandler());
        if (!action) {
            return next.handle();
        }

        const request = context.switchToHttp().getRequest();

        return next.handle().pipe(
            tap(async () => {
                const tenantId = this.cls.get('tenantId');
                const userId = this.cls.get('userId');
                const ip = request.ip;
                const userAgent = request.headers['user-agent'];

                if (tenantId && userId) {
                    try {
                        await this.auditService.log({
                            tenantId,
                            userId,
                            action,
                            metadata: {
                                method: request.method,
                                url: request.url,
                                // We might want to filter sensitive data from body here if needed
                                body: this.sanitizeBody(request.body)
                            },
                            ipAddress: ip,
                            userAgent
                        });
                    } catch (error) {
                        // Don't fail the request if audit logging fails
                        console.error('Audit logging failed:', error);
                    }
                }
            })
        );
    }

    private sanitizeBody(body: any): any {
        if (!body) return body;
        const sanitized = { ...body };
        const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'key'];

        for (const key of sensitiveKeys) {
            if (key in sanitized) {
                sanitized[key] = '********';
            }
        }
        return sanitized;
    }
}
