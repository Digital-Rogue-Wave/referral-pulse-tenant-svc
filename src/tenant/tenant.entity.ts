import EntityHelper from '@mod/common/entities/entity-helper';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { FileEntity } from '@mod/files/file.entity';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany } from 'typeorm';
import { InvitationEntity } from '@mod/invitation/invitation.entity';
import { TeamMemberEntity } from '../team-member/team-member.entity';

@Entity({ name: 'tenants' })
export class TenantEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({ unique: true })
    slug: string;

    @ManyToOne(() => FileEntity, {
        eager: true
    })
    image?: FileEntity | null;

    @Column({
        type: 'enum',
        enum: TenantStatusEnum,
        default: TenantStatusEnum.ACTIVE
    })
    status: TenantStatusEnum;

    @Column({ type: 'jsonb', default: {} })
    settings: Record<string, any>;

    @Column({ type: 'timestamp', nullable: true })
    deletionScheduledAt?: Date;

    @Column({ type: 'text', nullable: true })
    deletionReason?: string;

    @OneToMany('InvitationEntity', 'tenant')
    invitations: InvitationEntity[];

    @OneToMany('TeamMemberEntity', 'tenant')
    members: TeamMemberEntity[];
}
