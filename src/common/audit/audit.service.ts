import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditAction } from './audit-action.enum';

export interface CreateAuditLogDto {
    tenantId: string;
    userId?: string;
    userEmail?: string;
    action: AuditAction;
    description?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
}

@Injectable()
export class AuditService {
    constructor(
        @InjectRepository(AuditLog)
        private readonly auditLogRepository: Repository<AuditLog>
    ) {}

    /**
     * Create an audit log entry
     */
    async log(data: CreateAuditLogDto): Promise<AuditLog> {
        const auditLog = this.auditLogRepository.create(data);
        return await this.auditLogRepository.save(auditLog);
    }

    /**
     * Get audit logs for a tenant with pagination and filtering
     */
    async findByTenant(
        tenantId: string,
        options?: {
            action?: AuditAction;
            userId?: string;
            startDate?: Date;
            endDate?: Date;
            limit?: number;
            offset?: number;
        }
    ): Promise<{ logs: AuditLog[]; total: number }> {
        const query = this.auditLogRepository.createQueryBuilder('audit_log').where('audit_log.tenant_id = :tenantId', { tenantId });

        if (options?.action) {
            query.andWhere('audit_log.action = :action', { action: options.action });
        }

        if (options?.userId) {
            query.andWhere('audit_log.user_id = :userId', { userId: options.userId });
        }

        if (options?.startDate) {
            query.andWhere('audit_log.created_at >= :startDate', { startDate: options.startDate });
        }

        if (options?.endDate) {
            query.andWhere('audit_log.created_at <= :endDate', { endDate: options.endDate });
        }

        query.orderBy('audit_log.created_at', 'DESC');

        if (options?.limit) {
            query.limit(options.limit);
        }

        if (options?.offset) {
            query.offset(options.offset);
        }

        const [logs, total] = await query.getManyAndCount();

        return { logs, total };
    }

    /**
     * Delete old audit logs (for cleanup jobs)
     */
    async deleteOlderThan(date: Date): Promise<number> {
        const result = await this.auditLogRepository.createQueryBuilder().delete().where('created_at < :date', { date }).execute();

        return result.affected || 0;
    }
}
