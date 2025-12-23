import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { InvitationStatusEnum } from '../common/enums/invitation.enum';
import { RoleEnum } from '../common/enums/role.enum';
import { AutoMap } from '@automapper/classes';
import EntityHelper from '@mod/common/entities/entity-helper';

@Entity('invitations')
export class InvitationEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    @AutoMap()
    id: string;

    @Column()
    @AutoMap()
    tenantId: string;

    @Column()
    @AutoMap()
    email: string;

    @Column({
        type: 'enum',
        enum: RoleEnum,
        default: RoleEnum.MEMBER
    })
    @AutoMap()
    role: RoleEnum;

    @Column({
        type: 'enum',
        enum: InvitationStatusEnum,
        default: InvitationStatusEnum.PENDING
    })
    @AutoMap()
    status: InvitationStatusEnum;

    @Column({ unique: true })
    @AutoMap()
    token: string;

    @Column()
    @AutoMap()
    expiresAt: Date;
}
