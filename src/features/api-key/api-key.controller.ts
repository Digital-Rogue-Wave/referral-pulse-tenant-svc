import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiBody, ApiOkResponse, ApiHeader } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation, KetoResource } from '@common/auth/keto.constants';
import { Paginate, PaginateQuery, Paginated, ApiPaginationQuery } from '@common/nestjs-prisma-pagination';
import { Idempotent, IdempotencyScope } from '@common/idempotency';

import { CreateApiKeyDto, UpdateApiKeyDto, ApiKeyResponse, ApiKeyWithRawKeyResponse } from '@domains/api-key';

import { ApiKeyService } from './api-key.service';
import { API_KEY_PAGINATE_CONFIG } from './api-key.pagination';

@ApiTags('API Keys')
@ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: 'Tenant ID header',
    schema: { type: 'string' }
})
@Controller({ path: 'api-keys', version: '1' })
@ApiBearerAuth()
export class ApiKeyController {
    constructor(private readonly apiKeyService: ApiKeyService) {}

    @ApiBody({ type: CreateApiKeyDto })
    @ApiCreatedResponse({
        description: 'API key created successfully',
        type: ApiKeyWithRawKeyResponse
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.API_KEY, relation: KetoRelation.CREATE })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    async create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: IAuthenticatedUser): Promise<ApiKeyWithRawKeyResponse> {
        return this.apiKeyService.create(user.userId, dto);
    }

    @ApiPaginationQuery(API_KEY_PAGINATE_CONFIG)
    @ApiOkResponse({
        description: 'List of API keys',
        type: ApiKeyResponse,
        isArray: true
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.API_KEY, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Paginate() query: PaginateQuery): Promise<Paginated<ApiKeyResponse>> {
        return this.apiKeyService.findAll(query);
    }

    @ApiOkResponse({
        description: 'API key details',
        type: ApiKeyResponse
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ })
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
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.API_KEY, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async update(@Param('id') id: string, @Body() dto: UpdateApiKeyDto, @CurrentUser() user: IAuthenticatedUser): Promise<ApiKeyResponse> {
        return this.apiKeyService.update(id, user.userId, dto);
    }

    @ApiOkResponse({ description: 'API key revoked successfully' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.API_KEY, relation: KetoRelation.DELETE })
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async delete(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        await this.apiKeyService.delete(id, user.userId);
    }
}
