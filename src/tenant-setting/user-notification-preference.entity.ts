import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, Unique } from 'typeorm';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import EntityHelper from '@mod/common/entities/entity-helper';
import { AutoMap } from '@automapper/classes';

@Entity({ name: 'user_notification_preferences' })
@Unique(['userId', 'tenantId'])
export class UserNotificationPreferenceEntity extends EntityHelper {
    @AutoMap()
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @AutoMap()
    @Column()
    userId: string;

    @AutoMap()
    @Column()
    tenantId: string;

    @AutoMap(() => Object)
    @Column({ type: 'jsonb', default: {} })
    overrides: {
        emailEnabled?: boolean;
        smsEnabled?: boolean;
        pushEnabled?: boolean;
    };

    @AutoMap(() => TenantEntity)
    @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
    tenant: TenantEntity;
}
