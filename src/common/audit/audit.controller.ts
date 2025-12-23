import { Controller, Get, Param, UseGuards, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { Paginate, PaginateQuery, Paginated } from 'nestjs-paginate';
import { AuditService } from './audit.service';
import { AuditLogEntity } from './audit-log.entity';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { Response } from 'express';

@ApiTags('Audit Logs')
@ApiHeader({
    name: 'tenant-id',
    required: true,
    description: 'Tenant-Id header',
    schema: { type: 'string' }
})
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, KetoGuard)
@Controller({ path: 'tenants', version: '1' })
export class AuditController {
    constructor(private readonly auditService: AuditService) {}

    @Get(':id/audit-log')
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.VIEW, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Get audit logs for a specific tenant' })
    @ApiOkResponse({ description: 'Paginated list of audit logs' })
    async getAuditLogs(@Param('id') id: string, @Paginate() query: PaginateQuery): Promise<Paginated<AuditLogEntity>> {
        return await this.auditService.findAll(id, query);
    }

    @Get(':id/audit-log/export')
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.VIEW, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Export audit logs for a specific tenant as CSV' })
    @ApiOkResponse({ description: 'CSV file content' })
    async exportAuditLogs(@Param('id') id: string, @Res() res: Response): Promise<void> {
        const csv = await this.auditService.exportCsv(id);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=audit-log-${id}-${new Date().toISOString()}.csv`);
        res.status(HttpStatus.OK).send(csv);
    }
}
