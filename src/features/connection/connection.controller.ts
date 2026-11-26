import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';
import type { IAuthenticatedUser } from '@app/types';

import { ConnectionResponse, ConnectionTestResponse, CreateConnectionDto, RotateConnectionDto } from '@domains/connection';

import { ConnectionService } from './connection.service';

/**
 * Connections (v5.2 API §3.16), an Owner resource: every route is `api_keys:manage`, checked live. The callbacks
 * themselves are received by Event Ingestion, never here.
 */
@ApiTags('Connections')
@ApiBearerAuth()
@Controller({ path: 'connections', version: '1' })
export class ConnectionController {
    constructor(private readonly connections: ConnectionService) {}

    @ApiBody({ type: CreateConnectionDto })
    @ApiCreatedResponse({ description: 'Connection created, pending verification; inbound ones carry their `inbound_url`', type: ConnectionResponse })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(@Body() dto: CreateConnectionDto, @CurrentUser() user: IAuthenticatedUser): Promise<ConnectionResponse> {
        return this.connections.create(user.userId, dto);
    }

    @ApiOkResponse({ description: 'A page of connections, newest first (credentials never returned)', type: CursorPage })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Query() query: ListQueryDto): Promise<CursorPage<ConnectionResponse>> {
        return this.connections.findAll(query);
    }

    @ApiOkResponse({ description: 'One connection (credentials never returned)', type: ConnectionResponse })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<ConnectionResponse> {
        return this.connections.findOne(id);
    }

    @ApiBody({ type: RotateConnectionDto })
    @ApiOkResponse({ description: 'Credentials replaced; a replaced signing secret is honoured for 24 h', type: ConnectionResponse })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Post(':id/rotate')
    async rotate(@Param('id') id: string, @Body() dto: RotateConnectionDto, @CurrentUser() user: IAuthenticatedUser): Promise<ConnectionResponse> {
        return this.connections.rotate(id, user.userId, dto);
    }

    @ApiOkResponse({
        description: 'Outbound connectivity check (payout provider, CRM); success activates a pending connection',
        type: ConnectionTestResponse
    })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Post(':id/test')
    async test(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<ConnectionTestResponse> {
        return this.connections.test(id, user.userId);
    }

    @ApiOkResponse({ description: 'Connection revoked; its callbacks are refused from now on' })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    async revoke(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        await this.connections.revoke(id, user.userId);
    }
}
