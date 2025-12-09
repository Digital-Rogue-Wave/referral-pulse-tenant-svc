import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { ClsRequestContext } from '@domains/context/cls-request-context';
import { TenantContext } from '@mod/types/app.interface';

@Injectable()
export class ClsTenantContext implements TenantContext {
    constructor(private readonly cls: ClsService<ClsRequestContext>) {}
    getTenantId(): string | undefined {
        return this.cls.get('tenantId') as string | undefined;
    }
}
