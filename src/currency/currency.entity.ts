import EntityHelper from '@mod/common/entities/entity-helper';
import { Entity, Column, PrimaryColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity({ name: 'currencies' })
export class CurrencyEntity extends EntityHelper {
    @ApiProperty({ example: 'USD', description: 'ISO 4217 Currency Code' })
    @PrimaryColumn({ length: 3 })
    code: string;

    @ApiProperty({ example: 'US Dollar', description: 'Currency Name' })
    @Column()
    name: string;

    @ApiProperty({ example: '$', description: 'Currency Symbol' })
    @Column()
    symbol: string;

    @ApiProperty({ example: 2, description: 'Number of decimal places' })
    @Column({ type: 'int', default: 2 })
    decimals: number;
}
