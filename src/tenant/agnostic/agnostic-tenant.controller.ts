import { Controller, Post, Body, HttpCode, HttpStatus, UseInterceptors, UploadedFile } from '@nestjs/common';
import { AgnosticTenantService } from './agnostic-tenant.service';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiExtraModels, ApiTags, getSchemaPath, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParseFormdataPipe } from '@mod/common/pipes/parse-formdata.pipe';
import { Utils } from '@mod/common/utils/utils';
import { MapInterceptor } from '@automapper/nestjs';
import { CurrentUser, CurrentUserType } from '@mod/common/auth/current-user.decorator';
import { CreateTenantDto } from '../dto/tenant/create-tenant.dto';
import { TenantDto } from '../dto/tenant/tenant.dto';
import { TenantEntity } from '../tenant.entity';

@ApiTags('Agnostic Tenants')
@ApiBearerAuth()
@Controller({ path: 'tenants', version: '1' })
export class AgnosticTenantController {
    constructor(private readonly tenantService: AgnosticTenantService) {}

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
    @ApiCreatedResponse({ type: TenantDto, description: 'The tenant has been successfully created' })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto))
    @UseInterceptors(FileInterceptor('file'))
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(
        @CurrentUser() user: CurrentUserType,
        @Body('data', ParseFormdataPipe) data: any,
        @UploadedFile() file?: Express.Multer.File | Express.MulterS3.File
    ): Promise<TenantEntity> {
        const createTenantDto = await Utils.validateDtoOrFail(CreateTenantDto, data);
        // Override ownerId with authenticated user
        createTenantDto.ownerId = user.id;
        return await this.tenantService.create(createTenantDto, file);
    }
}
