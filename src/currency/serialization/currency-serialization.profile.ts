import { AutomapperProfile, InjectMapper } from '@automapper/nestjs';
import { createMap, Mapper } from '@automapper/core';
import { Injectable } from '@nestjs/common';
import { CurrencyEntity } from '../currency.entity';
import { CurrencyDto } from '../dto/currency.dto';

@Injectable()
export class CurrencySerializationProfile extends AutomapperProfile {
    constructor(@InjectMapper() mapper: Mapper) {
        super(mapper);
    }

    override get profile() {
        return (mapper: Mapper) => {
            createMap(mapper, CurrencyEntity, CurrencyDto);
        };
    }
}
