import { Global, Module, DynamicModule, Type } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { ulid } from 'ulid';
import { ClsTenantContextService } from './cls-tenant-context.service';
import { createTenantAwareRepositoryProvider } from './tenant-aware-repository';
import { DateService } from '@app/common/helper/date.service';
import type { ObjectLiteral, EntityTarget } from 'typeorm';

export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

@Global()
@Module({
    imports: [
        ClsModule.forRoot({
            global: true,
            middleware: {
                mount: true,
                generateId: true,
                idGenerator: () => ulid(),
                setup: (cls, req) => {
                    const dateService = new DateService();
                    cls.set('requestId', req.requestId || ulid());
                    cls.set('tenantId', req.tenantId || req.headers['x-tenant-id'] || '');
                    cls.set('userId', req.userId || '');
                    cls.set('correlationId', req.correlationId || req.headers['x-correlation-id'] || ulid());
                    cls.set('idempotencyKey', req.idempotencyKey || req.headers['x-idempotency-key']);
                    cls.set('ip', req.ip);
                    cls.set('userAgent', req.headers['user-agent']);
                    cls.set('route', req.path);
                    cls.set('method', req.method);
                    cls.set('startTime', dateService.now());
                },
            },
        }),
    ],
    providers: [
        ClsTenantContextService,
        { provide: TENANT_CONTEXT, useExisting: ClsTenantContextService },
    ],
    exports: [ClsTenantContextService, TENANT_CONTEXT, ClsModule],
})
export class TenantModule {
    static forEntities(entities: EntityTarget<ObjectLiteral>[]): DynamicModule {
        const providers = entities.map((entity) => createTenantAwareRepositoryProvider(entity));
        return {
            module: TenantModule,
            providers,
            exports: providers.map((p) => p.provide),
        };
    }
}

export { ClsTenantContextService };
export { TenantAwareRepository, InjectTenantAwareRepository, createTenantAwareRepositoryProvider } from './tenant-aware-repository';
