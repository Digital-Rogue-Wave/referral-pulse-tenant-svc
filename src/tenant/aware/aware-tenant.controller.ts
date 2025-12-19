import {
    Controller,
    Get,
    Body,
    Param,
    Delete,
    Put,
    Post,
    HttpCode,
    HttpStatus,
    UseInterceptors,
    UploadedFile,
    UseGuards,
    Ip,
    Query
} from '@nestjs/common';
import { AwareTenantService } from './aware-tenant.service';
import { NullableType } from '@mod/types/nullable.type';
import { DeleteResult } from 'typeorm';
import { ApiBody, ApiConsumes, ApiExtraModels, ApiOkResponse, ApiTags, getSchemaPath, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { DomainVerificationStatusEnum } from '@mod/common/enums/tenant.enum';
import { ParseFormdataPipe } from '@mod/common/pipes/parse-formdata.pipe';
import { Utils } from '@mod/common/utils/utils';
import { MapInterceptor } from '@automapper/nestjs';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { CurrentUser, CurrentUserType } from '@mod/common/auth/current-user.decorator';
import { TenantDto } from '../dto/tenant/tenant.dto';
import { TenantEntity } from '../tenant.entity';
import { UpdateTenantDto } from '../dto/tenant/update-tenant.dto';
import { TransferOwnershipDto } from '../dto/transfer-ownership.dto';
import { ScheduleDeletionDto } from '../dto/schedule-deletion.dto';
import { CancelDeletionDto } from '../dto/cancel-deletion.dto';
import { TenantStatsDto } from '../dto/stats/tenant-stats.dto';
import { TenantStatsService } from '../tenant-stats.service';

@ApiTags('tenants')
@ApiHeader({
    name: 'tenant-id',
    required: true,
    description: 'Tenant-Id header',
    schema: { type: 'string' }
})
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'tenants', version: '1' })
export class AwareTenantController {
    constructor(
        private readonly tenantService: AwareTenantService,
        private readonly statsService: TenantStatsService
    ) {}

    @ApiOkResponse({
        description: 'Get dashboard stats for current tenant',
        type: TenantStatsDto
    })
    @HttpCode(HttpStatus.OK)
    @Get(':id/stats')
    async getStats(@Param('id') id: string): Promise<TenantStatsDto> {
        return await this.statsService.getStats(id);
    }

    @ApiOkResponse({ type: TenantDto, isArray: true })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto, { isArray: true }))
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll() {
        return await this.tenantService.findAll();
    }

    @ApiOkResponse({
        description: 'Check if subdomain is available',
        schema: {
            type: 'object',
            properties: {
                available: { type: 'boolean' }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    @Get('subdomain/check')
    async checkSubdomain(@Query('subdomain') subdomain: string) {
        return await this.tenantService.checkSubdomainAvailability(subdomain);
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
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto))
    @UseGuards(KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    async update(
        @CurrentUser() user: CurrentUserType,
        @Param('id') id: string,
        @Body('data', ParseFormdataPipe) data: any,
        @UploadedFile() file?: Express.Multer.File | Express.MulterS3.File
    ) {
        const updateTenantDto = await Utils.validateDtoOrFail(UpdateTenantDto, data);
        return await this.tenantService.update(id, updateTenantDto, file, user.id, user.email);
    }

    @ApiOkResponse({
        description: 'Domain verified successfully',
        type: TenantDto
    })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto))
    @UseGuards(KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @Post(':id/custom-domain/verify')
    async verifyCustomDomain(@Param('id') id: string): Promise<TenantDto> {
        // @ts-ignore
        return await this.tenantService.verifyCustomDomain(id);
    }

    @ApiOkResponse({
        description: 'Get custom domain verification status',
        schema: {
            type: 'object',
            properties: {
                customDomain: { type: 'string' },
                domainVerificationStatus: { enum: Object.values(DomainVerificationStatusEnum) },
                domainVerificationToken: { type: 'string' }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    @Get(':id/custom-domain/status')
    async getDomainStatus(@Param('id') id: string) {
        return await this.tenantService.getDomainStatus(id);
    }

    @ApiOkResponse({ description: 'Ownership transferred successfully' })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @Put(':id/transfer-ownership')
    async transferOwnership(@Param('id') id: string, @Body() dto: TransferOwnershipDto, @CurrentUser() user: CurrentUserType): Promise<void> {
        return await this.tenantService.transferOwnership(id, dto.newOwnerId, user.id);
    }

    @ApiBody({ type: ScheduleDeletionDto })
    @ApiOkResponse({
        description: 'Deletion scheduled successfully',
        schema: {
            type: 'object',
            properties: {
                scheduledAt: { type: 'string', format: 'date-time' },
                executionDate: { type: 'string', format: 'date-time' }
            }
        }
    })
    @UseGuards(KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.DELETE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @Put(':id/schedule-deletion')
    async scheduleDeletion(
        @Param('id') id: string,
        @Body() dto: ScheduleDeletionDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string
    ): Promise<{ scheduledAt: Date; executionDate: Date }> {
        const validatedDto = await Utils.validateDtoOrFail(ScheduleDeletionDto, dto);
        return await this.tenantService.scheduleDeletion(id, validatedDto, user.id, user.identityId, ipAddress);
    }

    @ApiBody({ type: CancelDeletionDto })
    @ApiOkResponse({ description: 'Deletion cancelled successfully' })
    @UseGuards(KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @Put(':id/cancel-deletion')
    async cancelDeletion(
        @Param('id') id: string,
        @Body() dto: CancelDeletionDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string
    ): Promise<void> {
        const validatedDto = await Utils.validateDtoOrFail(CancelDeletionDto, dto);
        return await this.tenantService.cancelDeletion(id, validatedDto, user.id, user.identityId, ipAddress);
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
