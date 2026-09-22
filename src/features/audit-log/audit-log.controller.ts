import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '@common/auth/require-permission.decorator';
import { CursorPage } from '@common/http-contract/cursor-page';
import { AuditLogQueryDto, AuditLogResponse } from '@domains/audit-log';

import { AuditLogService } from './audit-log.service';

/** Operator-action trail for the dashboard (API Contract v1.3 §8.3: "dashboard only"). */
@ApiTags('Audit log')
@ApiBearerAuth()
@Controller({ path: 'audit-log', version: '1' })
export class AuditLogController {
    constructor(private readonly auditLog: AuditLogService) {}

    @ApiOperation({ summary: 'List operator actions, newest first' })
    @ApiOkResponse({ type: CursorPage })
    @RequirePermission('audit:read')
    @HttpCode(HttpStatus.OK)
    @Get()
    async list(@Query() query: AuditLogQueryDto): Promise<CursorPage<AuditLogResponse>> {
        return this.auditLog.list(query);
    }
}
