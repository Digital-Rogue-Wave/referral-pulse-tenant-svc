import { PartialType } from '@nestjs/swagger';
import { CreateTenantSettingDto } from './create-tenant-setting.dto';

export class UpdateTenantSettingDto extends PartialType(CreateTenantSettingDto) {}
