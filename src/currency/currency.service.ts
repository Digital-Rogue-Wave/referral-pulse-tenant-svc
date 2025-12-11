import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrencyEntity } from './currency.entity';
import { CurrencyDto } from './dto/currency.dto';

@Injectable()
export class CurrencyService {
    constructor(
        @InjectRepository(CurrencyEntity)
        private readonly currencyRepository: Repository<CurrencyEntity>
    ) {}

    async findAll(): Promise<CurrencyEntity[]> {
        return this.currencyRepository.find();
    }

    async findOne(code: string): Promise<CurrencyEntity | null> {
        return this.currencyRepository.findOne({ where: { code } });
    }

    async create(dto: CurrencyDto): Promise<CurrencyEntity> {
        return this.currencyRepository.save(this.currencyRepository.create(dto));
    }
}
