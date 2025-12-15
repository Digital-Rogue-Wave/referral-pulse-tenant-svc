import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { InvitationStatusEnum } from '../common/enums/invitation.enum';
import { RoleEnum } from '../common/enums/role.enum';
import EntityHelper from '@mod/common/entities/entity-helper';

@Entity('invitations')
export class InvitationEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    tenantId: string;

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
}
