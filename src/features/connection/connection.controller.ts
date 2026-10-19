import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';
import type { IAuthenticatedUser } from '@app/types';

import { ConnectionResponse, CreateConnectionDto } from '@domains/connection';

import { ConnectionService } from './connection.service';

/**
 * Provider connections (API Contract §6.5: `POST /v1/connections`, Owner, `api_keys:manage`). The
 * connection's secret is what Event Ingestion verifies provider callbacks against; the callbacks
 * themselves are received by that service, never here.
 *
 * `api_keys:manage` rather than a `connections:*` relation because §6.5 names it, and it is the
 * existing relation for "credentials that let something talk to the platform".
 */
@ApiTags('Connections')
@ApiBearerAuth()
@Controller({ path: 'connections', version: '1' })
export class ConnectionController {
    constructor(private readonly connections: ConnectionService) {}

    @ApiBody({ type: CreateConnectionDto })
    @ApiCreatedResponse({ description: 'Connection created; post provider callbacks to `receiver_url`', type: ConnectionResponse })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(@Body() dto: CreateConnectionDto, @CurrentUser() user: IAuthenticatedUser): Promise<ConnectionResponse> {
        return this.connections.create(user.userId, dto);
    }

    @ApiOkResponse({ description: 'A page of connections, newest first', type: CursorPage })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Query() query: ListQueryDto): Promise<CursorPage<ConnectionResponse>> {
        return this.connections.findAll(query);
    }

    @ApiOkResponse({ description: 'Connection revoked; its callbacks are refused from now on' })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    async revoke(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        await this.connections.revoke(id, user.userId);
    }
}
