import { Controller, Get, Post, Delete, Body, Param, UseGuards, HttpCode, HttpStatus, Put, UseInterceptors, Ip, Headers } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { UpdateApiKeyStatusDto } from './dto/update-api-key-status.dto';
import { ApiKeyDto } from './dto/api-key.dto';
import { CurrentUser, CurrentUserType } from '@mod/common/auth/current-user.decorator';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoRelation } from '@mod/common/auth/keto.constants';
import { ApiKeyEntity } from './api-key.entity';

import { MapInterceptor } from '@automapper/nestjs';
import { NullableType } from '@mod/types/nullable.type';

@ApiTags('API Keys')
@Controller({ path: 'api-keys', version: '1' })
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, KetoGuard)
export class ApiKeyController {
    constructor(private readonly apiKeyService: ApiKeyService) {}

    @ApiBody({
        type: CreateApiKeyDto,
        description: 'API key creation request'
    })
    @ApiCreatedResponse({
        description: 'API key created successfully',
        type: ApiKeyDto
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.CREATE_API_KEY,
        objectParam: 'tenantId'
    })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(
        @Body() createDto: CreateApiKeyDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string,
        @Headers('user-agent') userAgent: string
    ): Promise<ApiKeyEntity> {
        return await this.apiKeyService.create(user.id, createDto, ipAddress, userAgent);
    }

    @ApiOkResponse({
        description: 'List of API keys',
        type: ApiKeyDto,
        isArray: true
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.LIST_API_KEY,
        objectParam: 'tenantId'
    })
    @UseInterceptors(MapInterceptor(ApiKeyEntity, ApiKeyDto, { isArray: true }))
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(): Promise<ApiKeyEntity[]> {
        return await this.apiKeyService.findAll();
    }

    @ApiOkResponse({
        description: 'API key details',
        type: ApiKeyDto
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.READ,
        objectParam: 'tenantId'
    })
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<NullableType<ApiKeyDto>> {
        return await this.apiKeyService.findOne({ id });
    }

    @ApiBody({
        type: UpdateApiKeyDto,
        description: 'API key update request'
    })
    @ApiOkResponse({
        type: ApiKeyDto,
        description: 'API key updated successfully'
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.UPDATE_API_KEY,
        objectParam: 'tenantId'
    })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    async update(
        @Param('id') id: string,
        @Body() updateDto: UpdateApiKeyDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string,
        @Headers('user-agent') userAgent: string
    ): Promise<ApiKeyDto> {
        return await this.apiKeyService.update(id, user.id, updateDto, ipAddress, userAgent);
    }

    @ApiBody({
        type: UpdateApiKeyStatusDto,
        description: 'API key status update request'
    })
    @ApiOkResponse({
        type: ApiKeyDto,
        description: 'API key status updated successfully'
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.UPDATE_API_KEY,
        objectParam: 'tenantId'
    })
    @HttpCode(HttpStatus.OK)
    @Put(':id/status')
    async updateStatus(
        @Param('id') id: string,
        @Body() statusDto: UpdateApiKeyStatusDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string,
        @Headers('user-agent') userAgent: string
    ): Promise<ApiKeyDto> {
        return await this.apiKeyService.updateStatus(id, user.id, statusDto, ipAddress, userAgent);
    }

    @ApiOkResponse({
        type: ApiKeyDto,
        description: 'API key deleted successfully'
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.DELETE_API_KEY,
        objectParam: 'tenantId'
    })
    @HttpCode(HttpStatus.OK)
    @Delete(':id')
    async delete(
        @Param('id') id: string,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string,
        @Headers('user-agent') userAgent: string
    ): Promise<void> {
        await this.apiKeyService.delete(id, user.id, ipAddress, userAgent);
    }
}
