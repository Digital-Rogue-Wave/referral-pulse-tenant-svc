import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';
import { CurrencyDto } from '@mod/currency/dto/currency.dto';
import { TenantDto } from '@mod/tenant/dto/tenant/tenant.dto';
import { ApiProperty } from '@nestjs/swagger';

export class TenantSettingDto extends EntityHelperDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    branding: {
        primaryColor: string;
        secondaryColor: string;
        fontFamily: string;
    };

    @ApiProperty()
    notifications: {
        emailEnabled: boolean;
        webhookEnabled: boolean;
    };

    @ApiProperty()
    general: {
        timezone: string;
        locale: string;
    };

    @ApiProperty()
    currency: CurrencyDto;

    @ApiProperty()
    tenant: TenantDto;
}
