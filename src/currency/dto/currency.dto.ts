import { ApiProperty } from '@nestjs/swagger';
import { AutoMap } from '@automapper/classes';
import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';

export class CurrencyDto extends EntityHelperDto {
    @ApiProperty()
    @AutoMap()
    code: string;

    @ApiProperty()
    @AutoMap()
    name: string;

    @ApiProperty()
    @AutoMap()
    symbol: string;

    @ApiProperty()
    @AutoMap()
    decimals: number;
}
