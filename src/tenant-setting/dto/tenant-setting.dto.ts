import { AutoMap } from '@automapper/classes';
import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';
import { CurrencyDto } from '@mod/currency/dto/currency.dto';
import { TenantDto } from '@mod/tenant/dto/tenant/tenant.dto';
import { ApiProperty } from '@nestjs/swagger';

export class TenantSettingDto extends EntityHelperDto {
    @AutoMap()
    @ApiProperty()
    id: string;

    @AutoMap(() => Object)
    @ApiProperty()
    branding: {
        primaryColor: string;
        secondaryColor: string;
        fontFamily: string;
    };

    @AutoMap(() => Object)
    @ApiProperty()
    notifications: {
        emailEnabled: boolean;
        webhookEnabled: boolean;
    };

    @AutoMap(() => Object)
    @ApiProperty()
    general: {
        timezone: string;
        locale: string;
    };

    @AutoMap(() => CurrencyDto)
    @ApiProperty()
    currency: CurrencyDto;

    @AutoMap(() => TenantDto)
    @ApiProperty()
    tenant: TenantDto;
}
