import EntityHelper from '@mod/common/entities/entity-helper';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'tenant_usages' })
@Index(['tenantId', 'metricName', 'periodDate'], { unique: true })
export class TenantUsageEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'tenant_id', type: 'uuid' })
    tenantId: string;

    @ManyToOne(() => TenantEntity, {
        onDelete: 'CASCADE'
    })
    @JoinColumn({ name: 'tenant_id' })
    tenant: TenantEntity;

    @Column({ name: 'metric_name', type: 'varchar' })
    metricName: string;

    @Column({ name: 'period_date', type: 'date' })
    periodDate: string;

    @Column({ name: 'current_usage', type: 'integer', default: 0 })
    currentUsage: number;

    @Column({ name: 'limit_value', type: 'integer', nullable: true })
    limitValue?: number | null;
}
