import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteResult, FindOptionsRelations, FindOptionsWhere, Repository } from 'typeorm';
import { CurrencyEntity } from './currency.entity';
import { NullableType } from '@mod/types/nullable.type';
import { CreateCurrencyDto } from './dto/create-currency.dto';
import { UpdateCurrencyDto } from './dto/update-currency.dto';

@Injectable()
export class CurrencyService {
    constructor(
        @InjectRepository(CurrencyEntity)
        private readonly currencyRepository: Repository<CurrencyEntity>
    ) {}

    async create(createCurrencyDto: CreateCurrencyDto): Promise<CurrencyEntity> {
        const currency = this.currencyRepository.create(createCurrencyDto);
        return await this.currencyRepository.save(currency);
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

    async update(code: string, updateCurrencyDto: UpdateCurrencyDto): Promise<CurrencyEntity> {
        await this.currencyRepository.update({ code }, updateCurrencyDto);
        return this.findOneOrFail({ code });
    }

    async remove(code: string): Promise<DeleteResult> {
        return await this.currencyRepository.delete(code);
    }
}
