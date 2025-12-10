import { Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus, UseInterceptors, UploadedFile, UseGuards, Req } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantEntity } from './tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { NullableType } from '@mod/types/nullable.type';
import { DeleteResult } from 'typeorm';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiExtraModels, ApiOkResponse, ApiTags, getSchemaPath, ApiBearerAuth } from '@nestjs/swagger';
import { TenantDto } from './dto/tenant.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParseFormdataPipe } from '@mod/common/pipes/parse-formdata.pipe';
import { Utils } from '@mod/common/utils/utils';
import { MapInterceptor } from '@automapper/nestjs';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { Request } from 'express';
import { JwtPayload } from '@mod/types/app.interface';

@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'tenants', version: '1' })
export class TenantController {
    constructor(private readonly tenantService: TenantService) {}

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
        @Req() req: Request,
        @Body('data', ParseFormdataPipe) data: any,
        @UploadedFile() file?: Express.Multer.File | Express.MulterS3.File
    ): Promise<TenantEntity> {
        const createTenantDto = await Utils.validateDtoOrFail(CreateTenantDto, data);

        // Override ownerId with authenticated user
        const user = req.user as JwtPayload;
        createTenantDto.ownerId = user.sub;

        return await this.tenantService.create(createTenantDto, file);
    }

    @ApiOkResponse({ type: TenantDto, isArray: true })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto, { isArray: true }))
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll() {
        return await this.tenantService.findAll();
    }

    @ApiOkResponse({ type: TenantDto })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto))
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<NullableType<TenantEntity>> {
        return await this.tenantService.findOne({ id });
    }

    @ApiConsumes('multipart/form-data')
    @ApiExtraModels(UpdateTenantDto)
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary'
                },
                data: {
                    $ref: getSchemaPath(UpdateTenantDto)
                }
            }
        }
    })
    @ApiOkResponse({ type: TenantDto })
    @UseGuards(KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    async update(
        @Req() req: Request,
        @Param('id') id: string,
        @Body('data', ParseFormdataPipe) data: any,
        @UploadedFile() file?: Express.Multer.File | Express.MulterS3.File
    ) {
        const user = req.user as JwtPayload;
        const updateTenantDto = await Utils.validateDtoOrFail(UpdateTenantDto, data);
        return await this.tenantService.update(id, updateTenantDto, file, user.sub, user.email);
    }

    @ApiOkResponse({ type: DeleteResult })
    @UseGuards(KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.DELETE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @Delete(':id')
    async remove(@Param('id') id: string): Promise<DeleteResult> {
        return await this.tenantService.remove(id);
    }
}
