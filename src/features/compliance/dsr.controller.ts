import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import type { IAuthenticatedUser } from '@app/types';

import { CreateDsrDto, DsrRequestResponse } from '@domains/compliance';

import { DsrService } from './dsr.service';

/**
 * Data-subject requests — `POST /v1/data-subject-requests` and `GET /v1/data-subject-requests/{id}` (v5.1 renamed
 * API Contract §3.15's `/v1/dsr`, with no alias period). This service
 * hosts them because Product Spec R-CPL-01 makes it compliance's one coordinating owner.
 *
 * Gated on `programs:write`, v5.1 §4's "Owner only (`programs:write`)" for this method. The service's
 * own `dsr:manage` namespace (2026-10-20) was retired by E1 decision D16 to follow the catalogue;
 * effective access is unchanged (Owner only).
 */
@ApiTags('Compliance')
@ApiBearerAuth()
@Controller({ path: 'data-subject-requests', version: '1' })
export class DsrController {
    constructor(private readonly dsr: DsrService) {}

    @ApiOperation({
        summary: 'Submit a data-subject request (access · erasure · portability)',
        description: 'Erasure fans out to every service that holds the subject’s data. Access and portability are recorded and dated.'
    })
    @ApiBody({ type: CreateDsrDto })
    @ApiCreatedResponse({ description: 'Request recorded with its legal deadline', type: DsrRequestResponse })
    @RequirePermission('programs:write')
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async submit(@Body() dto: CreateDsrDto, @CurrentUser() user: IAuthenticatedUser): Promise<DsrRequestResponse> {
        return this.dsr.create(dto, user.userId);
    }

    @ApiOperation({ summary: 'Check a data-subject request and read its per-service receipts' })
    @ApiOkResponse({ type: DsrRequestResponse })
    @RequirePermission('programs:write')
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<DsrRequestResponse> {
        return this.dsr.findOne(id);
    }
}
