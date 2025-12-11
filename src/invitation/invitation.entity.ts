import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from '../tenant/tenant.entity';
import { InvitationStatusEnum } from '../common/enums/invitation.enum';
import { RoleEnum } from '../common/enums/role.enum';
import EntityHelper from '@mod/common/entities/entity-helper';

@Entity('invitations')
export class InvitationEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    email: string;

    @Column({
        type: 'enum',
        enum: RoleEnum,
        default: RoleEnum.MEMBER
    })
    role: RoleEnum;

    @Column({
        type: 'enum',
        enum: InvitationStatusEnum,
        default: InvitationStatusEnum.PENDING
    })
    status: InvitationStatusEnum;

    @Column({ unique: true })
    token: string;

    @Column()
    expiresAt: Date;

    @ManyToOne('TenantEntity', 'invitations', { onDelete: 'CASCADE' })
    tenant: TenantEntity;
}
