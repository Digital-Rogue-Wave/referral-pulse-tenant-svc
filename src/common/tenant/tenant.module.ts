import { Global, Module } from '@nestjs/common';
import { ClsTenantContext } from './cls-tenant-context.provider';
import { TenantContext } from '@mod/types/app.interface';

@Global()
@Module({
    providers: [{ provide: TenantContext, useClass: ClsTenantContext }],
    exports: [ClsTenantContext],
})
export class TenantModule {}
