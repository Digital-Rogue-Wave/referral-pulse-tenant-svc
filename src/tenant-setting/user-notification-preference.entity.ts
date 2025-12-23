import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, Unique } from 'typeorm';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import EntityHelper from '@mod/common/entities/entity-helper';

@Entity({ name: 'user_notification_preferences' })
@Unique(['userId', 'tenantId'])
export class UserNotificationPreferenceEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    userId: string;

    @Column()
    tenantId: string;

    @Column({ type: 'jsonb', default: {} })
    overrides: {
        emailEnabled?: boolean;
        smsEnabled?: boolean;
        pushEnabled?: boolean;
    };

    @ManyToOne('TenantEntity', { onDelete: 'CASCADE' })
    tenant: TenantEntity;
}
