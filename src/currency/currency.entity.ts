import EntityHelper from '@mod/common/entities/entity-helper';
import { Entity, Column, PrimaryColumn } from 'typeorm';
import { AutoMap } from '@automapper/classes';

@Entity({ name: 'currencies' })
export class CurrencyEntity extends EntityHelper {
    @AutoMap()
    @PrimaryColumn({ length: 3 })
    code: string;

    @AutoMap()
    @Column()
    name: string;

    @AutoMap()
    @Column()
    symbol: string;

    @AutoMap()
    @Column({ type: 'int', default: 2 })
    decimals: number;
}
