import { Module } from '@nestjs/common';

import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { AuditLogWriter } from './audit-log.writer';

/** `audit_log` (DB Model v2 §3): written from domain events inside their transaction, read by the dashboard. */
@Module({
    controllers: [AuditLogController],
    providers: [AuditLogWriter, AuditLogService]
})
export class AuditLogModule {}
