import EntityHelper from '@mod/common/entities/entity-helper';
import { Entity, Column, ManyToOne, OneToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { CurrencyEntity } from '@mod/currency/currency.entity';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { AutoMap } from '@automapper/classes';

@Entity({ name: 'tenant_settings' })
export class TenantSettingEntity extends EntityHelper {
    @AutoMap()
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @AutoMap(() => Object)
    @Column({ type: 'jsonb' })
    branding: {
        primaryColor: string;
        secondaryColor: string;
        fontFamily: string;
    };

    @AutoMap(() => Object)
    @Column({ type: 'jsonb' })
    notifications: {
        emailEnabled: boolean;
        webhookEnabled: boolean;
    };

    @AutoMap(() => Object)
    @Column({ type: 'jsonb' })
    general: {
        timezone: string;
        locale: string;
    };

    @AutoMap(() => CurrencyEntity)
    @ManyToOne(() => CurrencyEntity, { eager: true })
    currency: CurrencyEntity;

    @OneToOne('TenantEntity', 'setting', {
        onDelete: 'CASCADE',
        nullable: false
    })
    @JoinColumn()
    tenant: TenantEntity;
}
