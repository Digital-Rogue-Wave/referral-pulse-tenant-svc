import EntityHelper from '@mod/common/entities/entity-helper';
import { TenantStatusEnum, DomainVerificationStatusEnum } from '@mod/common/enums/tenant.enum';
import { PaymentStatusEnum } from '@mod/common/enums/billing.enum';
import { FileEntity } from '@mod/files/file.entity';
import { AutoMap } from '@automapper/classes';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { InvitationEntity } from '@mod/invitation/invitation.entity';
import { TeamMemberEntity } from '../team-member/team-member.entity';
import type { TenantSettingEntity } from '@mod/tenant-setting/tenant-setting.entity';

@Entity({ name: 'tenants' })
export class TenantEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    @AutoMap()
    id: string;

    @Column()
    @AutoMap()
    name: string;

    @Column({ unique: true })
    @AutoMap()
    slug: string;

    @ManyToOne(() => FileEntity, {
        eager: true
    })
    @AutoMap(() => FileEntity)
    image?: FileEntity | null;

    @Column({
        type: 'enum',
        enum: TenantStatusEnum,
        default: TenantStatusEnum.ACTIVE
    })
    @AutoMap()
    status: TenantStatusEnum;

    @Column({ type: 'timestamp', nullable: true })
    trialStartedAt?: Date;

    @Column({ type: 'timestamp', nullable: true })
    trialEndsAt?: Date;

    @Column({
        type: 'enum',
        enum: PaymentStatusEnum,
        enumName: 'payment_status_enum',
        default: PaymentStatusEnum.PENDING
    })
    paymentStatus: PaymentStatusEnum;

    @Column({ type: 'timestamp', nullable: true })
    suspendedAt?: Date;

    @Column({ type: 'timestamp', nullable: true })
    lockedAt?: Date;

    @Column({ type: 'timestamp', nullable: true })
    @AutoMap()
    lockUntil?: Date;

    @Column({ type: 'text', nullable: true })
    @AutoMap()
    lockReason?: string;

    @OneToOne('TenantSettingEntity', 'tenant', {
        cascade: true
    })
    setting: TenantSettingEntity;

    @Column({ type: 'timestamp', nullable: true })
    deletionScheduledAt?: Date;

    @Column({ type: 'text', nullable: true })
    deletionReason?: string;

    @Column({ nullable: true, unique: true })
    @AutoMap()
    customDomain?: string;

    @Column({
        type: 'enum',
        enum: DomainVerificationStatusEnum,
        default: DomainVerificationStatusEnum.UNVERIFIED
    })
    @AutoMap()
    domainVerificationStatus: DomainVerificationStatusEnum;

    @Column({ nullable: true })
    @AutoMap()
    domainVerificationToken?: string;

    @OneToMany('InvitationEntity', 'tenant')
    invitations: InvitationEntity[];

    @OneToMany('TeamMemberEntity', 'tenant')
    members: TeamMemberEntity[];
}
