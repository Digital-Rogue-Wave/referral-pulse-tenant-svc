import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, FindOptionsWhere, Repository } from 'typeorm';
import { CurrencyEntity } from './currency.entity';
import { CurrencyDto } from './dto/currency.dto';
import { NullableType } from '@mod/types/nullable.type';

@Injectable()
export class CurrencyService {
    constructor(
        @InjectRepository(CurrencyEntity)
        private readonly currencyRepository: Repository<CurrencyEntity>
    ) {}

    async create(dto: CurrencyDto): Promise<CurrencyEntity> {
        return this.currencyRepository.save(this.currencyRepository.create(dto));
    }

    async findAll(): Promise<CurrencyEntity[]> {
        return this.currencyRepository.find();
    }

    async findOne(field: FindOptionsWhere<CurrencyEntity>, relations?: FindOptionsRelations<CurrencyEntity>): Promise<NullableType<CurrencyEntity>> {
        return this.currencyRepository.findOne({ where: field, relations });
    }

    async findOneOrFail(field: FindOptionsWhere<CurrencyEntity>, relations?: FindOptionsRelations<CurrencyEntity>): Promise<CurrencyEntity> {
        return this.currencyRepository.findOneOrFail({ where: field, relations });
    }

    async update(code: string, updateDto: CurrencyDto): Promise<CurrencyEntity> {
        await this.currencyRepository.update({ code }, updateDto);
        return this.findOneOrFail({ code });
    }

    async remove(code: string): Promise<void> {
        await this.currencyRepository.delete(code);
    }
}
