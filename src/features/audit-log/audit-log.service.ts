import { Injectable } from '@nestjs/common';

import { CursorPage, cursorPage } from '@common/http-contract/cursor-page';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { DatabaseService } from '@app/database/database.service';
import { AuditLogProps, AuditLogQueryDto, AuditLogResponse, toAuditLogResponse } from '@domains/audit-log';

/** Read side of the operator-action trail. Rows are written by `AuditLogWriter`, never through this service. */
@Injectable()
export class AuditLogService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService
    ) {}

    async list(query: AuditLogQueryDto): Promise<CursorPage<AuditLogResponse>> {
        const occurredAt = {
            ...(query.occurredAfter ? { gte: new Date(query.occurredAfter) } : {}),
            ...(query.occurredBefore ? { lt: new Date(query.occurredBefore) } : {})
        };
        const where = this.tenantAware.withTenantFilter({
            ...(query.action ? { action: query.action } : {}),
            ...(query.targetType ? { targetType: query.targetType } : {}),
            ...(query.targetId ? { targetId: query.targetId } : {}),
            ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
            ...(Object.keys(occurredAt).length > 0 ? { occurredAt } : {})
        });
        return cursorPage(this.prisma.auditLog, where, query, (row) => toAuditLogResponse(row as AuditLogProps));
    }
}
