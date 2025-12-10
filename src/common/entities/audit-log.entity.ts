import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';
import { AuditAction } from '@mod/common/enums/audit-action.enum';

@Entity({ name: 'audit_logs' })
@Index(['tenantId', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
export class AuditLog {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'tenant_id', type: 'uuid' })
    tenantId: string;

    @Column({ name: 'user_id', type: 'uuid', nullable: true })
    userId: string;

    @Column({ name: 'user_email', nullable: true })
    userEmail: string;

    @Column({
        type: 'enum',
        enum: AuditAction
    })
    action: AuditAction;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column({ type: 'jsonb', nullable: true })
    metadata: Record<string, any>;

    @Column({ name: 'ip_address', nullable: true })
    ipAddress: string;

    @Column({ name: 'user_agent', nullable: true })
    userAgent: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
