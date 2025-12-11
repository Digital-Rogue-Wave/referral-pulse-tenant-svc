import EntityHelper from '@mod/common/entities/entity-helper';
import { ApiKeyStatusEnum } from '@mod/common/enums/api-key.enum';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';

@Entity({ name: 'api_keys' })
@Index(['tenantId', 'status'])
@Index(['keyPrefix'])
export class ApiKeyEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'tenant_id' })
    tenantId: string;

    @ManyToOne(() => TenantEntity, {
        onDelete: 'CASCADE'
    })
    @JoinColumn({ name: 'tenant_id' })
    tenant: TenantEntity;

    @Column()
    name: string;

    @Column({ name: 'key_hash' })
    keyHash: string;

    @Column({ name: 'key_prefix', length: 20 })
    keyPrefix: string;

    @Column({
        type: 'enum',
        enum: ApiKeyStatusEnum,
        default: ApiKeyStatusEnum.ACTIVE
    })
    status: ApiKeyStatusEnum;

    @Column({ type: 'jsonb', default: [] })
    scopes: string[];

    @Column({ name: 'created_by' })
    createdBy: string;

    @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
    lastUsedAt: Date | null;

    @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
    expiresAt: Date | null;
}
