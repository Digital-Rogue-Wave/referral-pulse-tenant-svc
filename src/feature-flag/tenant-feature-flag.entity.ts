import EntityHelper from '@mod/common/entities/entity-helper';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { FeatureFlagEntity } from './feature-flag.entity';

@Entity({ name: 'tenant_feature_flags' })
@Unique(['tenantId', 'featureKey'])
@Index(['tenantId'])
export class TenantFeatureFlagEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'tenant_id' })
    tenantId: string;

    @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: TenantEntity;

    @Column({ name: 'feature_key' })
    featureKey: string;

    @ManyToOne(() => FeatureFlagEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'feature_key' })
    featureFlag: FeatureFlagEntity;

    @Column({ name: 'is_enabled' })
    isEnabled: boolean;
}
