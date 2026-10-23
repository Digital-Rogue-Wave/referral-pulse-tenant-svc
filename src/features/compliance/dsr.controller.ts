import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import type { IAuthenticatedUser } from '@app/types';

import { CreateDsrDto, DsrRequestResponse } from '@domains/compliance';

import { DsrService } from './dsr.service';

/**
 * Data-subject requests — API Contract §3.15's `POST /v1/dsr` and `GET /v1/dsr/{id}`. This service
 * hosts them because Product Spec R-CPL-01 makes it compliance's one coordinating owner.
 *
 * Gated on `dsr:manage`. §3.15's table says `referrers:write` / `referrers:read` and its own revision
 * line says "Owner-only — permission to update to `programs:write`", so the contract disagrees with
 * itself and neither candidate is about data-subject requests. All three resolve to Owner-only, so
 * effective access is identical; a separate permission is what later lets a compliance officer answer
 * DSRs without also being able to edit participants or programs. Ratified 2026-10-20 (NOTE.md §V5.16).
 */
@ApiTags('Compliance')
@ApiBearerAuth()
@Controller({ path: 'dsr', version: '1' })
export class DsrController {
    constructor(private readonly dsr: DsrService) {}

    @ApiOperation({
        summary: 'Submit a data-subject request (access · erasure · portability)',
        description: 'Erasure fans out to every service that holds the subject’s data. Access and portability are recorded and dated.'
    })
    @ApiBody({ type: CreateDsrDto })
    @ApiCreatedResponse({ description: 'Request recorded with its legal deadline', type: DsrRequestResponse })
    @RequirePermission('dsr:manage')
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async submit(@Body() dto: CreateDsrDto, @CurrentUser() user: IAuthenticatedUser): Promise<DsrRequestResponse> {
        return this.dsr.create(dto, user.userId);
    }

    @ApiOperation({ summary: 'Check a data-subject request and read its per-service receipts' })
    @ApiOkResponse({ type: DsrRequestResponse })
    @RequirePermission('dsr:manage')
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<DsrRequestResponse> {
        return this.dsr.findOne(id);
    }
}
