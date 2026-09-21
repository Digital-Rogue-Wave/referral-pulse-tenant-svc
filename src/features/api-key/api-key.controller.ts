import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiBody, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';

import { CreateApiKeyDto, UpdateApiKeyDto, ApiKeyResponse, ApiKeyWithRawKeyResponse, RevokeApiKeyQueryDto } from '@domains/api-key';

import { ApiKeyService } from './api-key.service';

@ApiTags('API Keys')
@Controller({ path: 'api-keys', version: '1' })
@ApiBearerAuth()
export class ApiKeyController {
    constructor(private readonly apiKeyService: ApiKeyService) {}

    @ApiBody({ type: CreateApiKeyDto })
    @ApiCreatedResponse({
        description: 'API key created successfully',
        type: ApiKeyWithRawKeyResponse
    })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: IAuthenticatedUser): Promise<ApiKeyWithRawKeyResponse> {
        return this.apiKeyService.create(user.userId, dto);
    }

    @ApiOkResponse({ description: 'A page of API keys, newest first', type: CursorPage })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Query() query: ListQueryDto): Promise<CursorPage<ApiKeyResponse>> {
        return this.apiKeyService.findAll(query);
    }

    @ApiOkResponse({
        description: 'API key details',
        type: ApiKeyResponse
    })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<ApiKeyResponse> {
        return this.apiKeyService.findById(id);
    }

    @ApiBody({ type: UpdateApiKeyDto })
    @ApiOkResponse({
        description: 'API key updated successfully',
        type: ApiKeyResponse
    })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    async update(@Param('id') id: string, @Body() dto: UpdateApiKeyDto, @CurrentUser() user: IAuthenticatedUser): Promise<ApiKeyResponse> {
        return this.apiKeyService.update(id, user.userId, dto);
    }

    @ApiOkResponse({
        description: 'API key rotated; a new secret is returned exactly once',
        type: ApiKeyWithRawKeyResponse
    })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Post(':id/rotate')
    async rotate(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<ApiKeyWithRawKeyResponse> {
        return this.apiKeyService.rotate(id, user.userId);
    }

    @ApiOkResponse({ description: 'API key revoked successfully' })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    async delete(@Param('id') id: string, @Query() query: RevokeApiKeyQueryDto, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        await this.apiKeyService.delete(id, user.userId, query.reason);
    }
}
