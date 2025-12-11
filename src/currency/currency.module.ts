import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrencyEntity } from './currency.entity';
import { CurrencyService } from './currency.service';
import { CurrencyController } from './currency.controller';
import { CurrencySerializationProfile } from './serialization/currency-serialization.profile';

@Module({
    imports: [TypeOrmModule.forFeature([CurrencyEntity])],
    controllers: [CurrencyController],
    providers: [CurrencyService, CurrencySerializationProfile],
    exports: [CurrencyService]
})
export class CurrencyModule {}
