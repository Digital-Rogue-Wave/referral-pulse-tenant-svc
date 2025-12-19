import EntityHelper from '@mod/common/entities/entity-helper';
import { TenantStatusEnum, DomainVerificationStatusEnum } from '@mod/common/enums/tenant.enum';
import { FileEntity } from '@mod/files/file.entity';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { InvitationEntity } from '@mod/invitation/invitation.entity';
import { TeamMemberEntity } from '../team-member/team-member.entity';
import { TenantSettingEntity } from '@mod/tenant-setting/tenant-setting.entity';

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

    @OneToOne(() => TenantSettingEntity, (setting) => setting.tenant, {
        cascade: true
    })
    setting: TenantSettingEntity;

    @Column({ type: 'timestamp', nullable: true })
    deletionScheduledAt?: Date;

    @Column({ type: 'text', nullable: true })
    deletionReason?: string;

    @Column({ nullable: true, unique: true })
    customDomain?: string;

    @Column({
        type: 'enum',
        enum: DomainVerificationStatusEnum,
        default: DomainVerificationStatusEnum.UNVERIFIED
    })
    domainVerificationStatus: DomainVerificationStatusEnum;

    @Column({ nullable: true })
    domainVerificationToken?: string;

    @OneToMany('InvitationEntity', 'tenant')
    invitations: InvitationEntity[];

    @OneToMany('TeamMemberEntity', 'tenant')
    members: TeamMemberEntity[];
}
