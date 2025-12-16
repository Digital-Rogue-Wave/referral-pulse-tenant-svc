import EntityHelper from '@mod/common/entities/entity-helper';
import { Entity, Column, ManyToOne, OneToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { CurrencyEntity } from '@mod/currency/currency.entity';
import type { TenantEntity } from '@mod/tenant/tenant.entity';

@Entity({ name: 'tenant_settings' })
export class TenantSettingEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'jsonb' })
    branding: {
        primaryColor: string;
        secondaryColor: string;
        fontFamily: string;
    };

    @Column({ type: 'jsonb' })
    notifications: {
        emailEnabled: boolean;
        webhookEnabled: boolean;
    };

    @Column({ type: 'jsonb' })
    general: {
        timezone: string;
        locale: string;
    };

    @ManyToOne(() => CurrencyEntity, { eager: true })
    currency: CurrencyEntity;

    @OneToOne('TenantEntity', (tenant: TenantEntity) => tenant.setting, {
        onDelete: 'CASCADE',
        nullable: false
    })
    @JoinColumn()
    tenant: TenantEntity;
}
