import { Controller, Post, Body, HttpCode, HttpStatus, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiExtraModels, ApiTags, getSchemaPath, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

import { ParseFormdataPipe } from '@common/pipes/parse-formdata.pipe';
import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { Idempotent, IdempotencyScope } from '@common/idempotency';

import { TenantResponse, CreateTenantDto } from '@domains/tenant';

import { TenantService } from '../tenant.service';

@ApiTags('Agnostic Tenants')
@ApiBearerAuth()
@Controller({ path: 'tenants', version: '1' })
export class AgnosticTenantController {
    constructor(private readonly tenantService: TenantService) {}

    @Post()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    @ApiConsumes('multipart/form-data')
    @ApiExtraModels(CreateTenantDto)
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary'
                },
                data: {
                    $ref: getSchemaPath(CreateTenantDto)
                }
            }
        }
    })
    @ApiCreatedResponse({
        type: TenantResponse,
        description: 'The tenant has been successfully created'
    })
    @UseInterceptors(FileInterceptor('file'))
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentUser() user: IAuthenticatedUser,
        @Body('data', ParseFormdataPipe) data: CreateTenantDto,
        @UploadedFile() file?: Express.Multer.File | Express.MulterS3.File
    ): Promise<TenantResponse> {
        // Override ownerId with authenticated user
        data.ownerId = user.userId;
        return await this.tenantService.create(data, file);
    }
}
