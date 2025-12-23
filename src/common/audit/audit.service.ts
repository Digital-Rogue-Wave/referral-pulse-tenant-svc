import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';
import { AuditAction } from './audit-action.enum';
import { paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { auditLogPaginationConfig } from './config/audit-log-pagination.config';

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
        @InjectRepository(AuditLogEntity)
        private readonly auditLogRepository: Repository<AuditLogEntity>
    ) {}

    /**
     * Create an audit log entry
     */
    async log(data: CreateAuditLogDto): Promise<AuditLogEntity> {
        const auditLog = this.auditLogRepository.create(data);
        return await this.auditLogRepository.save(auditLog);
    }

    /**
     * Get audit logs for a tenant with pagination and filtering
     */
    async findAll(tenantId: string, query: PaginateQuery): Promise<Paginated<AuditLogEntity>> {
        const queryBuilder = this.auditLogRepository.createQueryBuilder('audit_log').where('audit_log.tenantId = :tenantId', { tenantId });
        return await paginate<AuditLogEntity>(query, queryBuilder, auditLogPaginationConfig);
    }

    /**
     * Delete old audit logs (for cleanup jobs)
     */
    async deleteOlderThan(date: Date): Promise<number> {
        const result = await this.auditLogRepository.createQueryBuilder().delete().where('created_at < :date', { date }).execute();

        return result.affected || 0;
    }

    /**
     * Export all audit logs for a tenant as CSV
     */
    async exportCsv(tenantId: string): Promise<string> {
        const logs = await this.auditLogRepository.find({
            where: { tenantId },
            order: { createdAt: 'DESC' }
        });

        const header = ['ID', 'Action', 'User ID', 'User Email', 'Metadata', 'IP Address', 'User Agent', 'Created At'].join(',');
        const rows = logs.map((log) => {
            return [
                log.id,
                log.action,
                log.userId || '',
                log.userEmail || '',
                `"${JSON.stringify(log.metadata || {}).replace(/"/g, '""')}"`,
                log.ipAddress || '',
                `"${(log.userAgent || '').replace(/"/g, '""')}"`,
                log.createdAt.toISOString()
            ].join(',');
        });

        return [header, ...rows].join('\n');
    }
}
