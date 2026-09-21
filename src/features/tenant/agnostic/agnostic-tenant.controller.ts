import { Controller, Post, Body, HttpCode, HttpStatus, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiExtraModels, ApiTags, getSchemaPath, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

import { FILE_UPLOAD_OPTIONS } from '@app/features/files/file-upload.policy';

import { ParseFormdataPipe } from '@common/pipes/parse-formdata.pipe';
import { AllowNoTenant } from '@common/auth/allow-no-tenant.decorator';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { BaseException } from '@common/exceptions/base.exceptions';
import type { IAuthenticatedUser } from '@app/types';
import { Idempotent, IdempotencyScope } from '@common/idempotency';

import { TenantResponse, CreateTenantDto } from '@domains/tenant';

import { TenantService } from '../tenant.service';

@ApiTags('Agnostic Tenants')
@ApiBearerAuth()
@Controller({ path: 'tenants', version: '1' })
export class AgnosticTenantController {
    constructor(private readonly tenantService: TenantService) {}

    /** Onboarding: a signed-in Ory identity with no tenant yet creates one and becomes its Owner. */
    @AllowNoTenant()
    @Post()
    @Idempotent({ scope: IdempotencyScope.User, ttl: 3600 })
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
    @UseInterceptors(FileInterceptor('file', FILE_UPLOAD_OPTIONS))
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentUser() user: IAuthenticatedUser,
        @Body('data', ParseFormdataPipe) data: CreateTenantDto,
        @UploadedFile() file?: Express.Multer.File | Express.MulterS3.File
    ): Promise<TenantResponse> {
        if (!user.identityId) {
            throw new BaseException('authentication_error', 'A signed-in user is required', HttpStatus.UNAUTHORIZED);
        }
        return await this.tenantService.createForIdentity(user.identityId, data, file);
    }
}
