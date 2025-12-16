import { Controller, Post, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { AgnosticTenantSettingService } from './agnostic-tenant-setting.service';
import { CreateTenantSettingDto } from '../dto/create-tenant-setting.dto';
import { TenantSettingEntity } from '../tenant-setting.entity';

@ApiTags('Tenant Settings')
@Controller({ path: 'tenant-settings', version: '1' })
export class AgnosticTenantSettingController {
    constructor(private readonly tenantSettingService: AgnosticTenantSettingService) {}

    @Post()
    @ApiBody({ type: CreateTenantSettingDto })
    @ApiOkResponse({ type: TenantSettingEntity, description: 'Created successfully' })
    @HttpCode(HttpStatus.CREATED)
    async createDefault(): Promise<TenantSettingEntity> {
        return await this.tenantSettingService.createDefault();
    }
}
