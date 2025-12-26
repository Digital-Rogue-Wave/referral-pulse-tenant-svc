import { Controller, Get, Body, Param, Delete, Put, HttpCode, HttpStatus, UseInterceptors, UploadedFile, UseGuards, Ip, Query } from '@nestjs/common';
import { AwareTenantService } from './aware-tenant.service';
import { NullableType } from '@mod/types/nullable.type';
import { DeleteResult } from 'typeorm';
import { ApiBody, ApiConsumes, ApiExtraModels, ApiOkResponse, ApiTags, getSchemaPath, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { ParseFormdataPipe } from '@mod/common/pipes/parse-formdata.pipe';
import { Utils } from '@mod/common/utils/utils';
import { MapInterceptor } from '@automapper/nestjs';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { CurrentUser, CurrentUserType } from '@mod/common/auth/current-user.decorator';
import { TenantDto } from '../dto/tenant/tenant.dto';
import { TenantProfileDto } from '../dto/tenant/tenant-profile.dto';
import { TenantEntity } from '../tenant.entity';
import { UpdateTenantDto } from '../dto/tenant/update-tenant.dto';
import { TransferOwnershipDto } from '../dto/transfer-ownership.dto';
import { ScheduleDeletionDto } from '../dto/schedule-deletion.dto';
import { CancelDeletionDto } from '../dto/cancel-deletion.dto';
import { TenantStatsDto } from '../dto/stats/tenant-stats.dto';
import { TenantStatsService } from './tenant-stats.service';
import { LockTenantDto } from '../dto/tenant/lock-tenant.dto';
import { UnlockTenantDto } from '../dto/tenant/unlock-tenant.dto';
import { DomainDto } from '@mod/tenant/dto/domain/domain.dto';
import { TenantStatusGuard } from '../guards/tenant-status.guard';
import { TenantLockGuard } from '../guards/tenant-lock.guard';

@ApiTags('Aware Tenants')
@ApiHeader({
    name: 'tenant-id',
    required: true,
    description: 'Tenant-Id header',
    schema: { type: 'string' }
})
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, KetoGuard, TenantStatusGuard, TenantLockGuard)
@Controller({ path: 'tenants', version: '1' })
export class AwareTenantController {
    constructor(
        private readonly tenantService: AwareTenantService,
        private readonly statsService: TenantStatsService
    ) {}

    @Get()
    @ApiOkResponse({ type: TenantDto, isArray: true })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto, { isArray: true }))
    @HttpCode(HttpStatus.OK)
    async findAll() {
        return await this.tenantService.findAll();
    }

    @Get('subdomain/check')
    @ApiOkResponse({ description: 'Check if subdomain is available' })
    @HttpCode(HttpStatus.OK)
    async checkSubdomain(@Query('subdomain') subdomain: string) {
        return await this.tenantService.checkSubdomainAvailability(subdomain);
    }

    @Get(':id/stats')
    @ApiOkResponse({
        description: 'Get dashboard stats for current tenant',
        type: TenantStatsDto
    })
    @HttpCode(HttpStatus.OK)
    async getStats(@Param('id') id: string): Promise<TenantStatsDto> {
        return await this.statsService.getStats(id);
    }

    @Get(':id/custom-domain/status')
    @ApiOkResponse({
        description: 'Get custom domain verification status',
        type: DomainDto
    })
    @HttpCode(HttpStatus.OK)
    async getDomainStatus(@Param('id') id: string): Promise<Partial<DomainDto>> {
        return await this.tenantService.getDomainStatus(id);
    }

    @Get(':id')
    @ApiOkResponse({ type: TenantProfileDto })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantProfileDto))
    @HttpCode(HttpStatus.OK)
    async findOne(@Param('id') id: string): Promise<NullableType<TenantEntity>> {
        return await this.tenantService.getProfile(id);
    }

    @Put(':id')
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
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    async update(
        @CurrentUser() user: CurrentUserType,
        @Param('id') id: string,
        @Body('data', ParseFormdataPipe) data: any,
        @UploadedFile() file?: Express.Multer.File | Express.MulterS3.File
    ): Promise<TenantEntity> {
        const updateTenantDto = await Utils.validateDtoOrFail(UpdateTenantDto, data);
        return await this.tenantService.update(id, updateTenantDto, user, file);
    }

    @Put(':id/custom-domain/verify')
    @ApiOkResponse({
        description: 'Domain verified successfully',
        type: TenantDto
    })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto))
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    async verifyCustomDomain(@Param('id') id: string): Promise<TenantEntity> {
        return await this.tenantService.verifyCustomDomain(id);
    }

    @Put(':id/transfer-ownership')
    @ApiOkResponse({ description: 'Ownership transferred successfully' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    async transferOwnership(
        @Param('id') id: string,
        @Body() dto: TransferOwnershipDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string
    ): Promise<void> {
        return await this.tenantService.transferOwnership(id, dto, user, ipAddress);
    }

    @Put(':id/schedule-deletion')
    @ApiBody({ type: ScheduleDeletionDto })
    @ApiOkResponse({ description: 'Deletion scheduled successfully' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.DELETE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    async scheduleDeletion(
        @Param('id') id: string,
        @Body() dto: ScheduleDeletionDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string
    ): Promise<{ scheduledAt: Date; executionDate: Date }> {
        const validatedDto = await Utils.validateDtoOrFail(ScheduleDeletionDto, dto);
        return await this.tenantService.scheduleDeletion(id, validatedDto, user, ipAddress);
    }

    @Put(':id/cancel-deletion')
    @ApiBody({ type: CancelDeletionDto })
    @ApiOkResponse({ description: 'Deletion cancelled successfully' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    async cancelDeletion(
        @Param('id') id: string,
        @Body() dto: CancelDeletionDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string
    ): Promise<void> {
        const validatedDto = await Utils.validateDtoOrFail(CancelDeletionDto, dto);
        return await this.tenantService.cancelDeletion(id, validatedDto, user, ipAddress);
    }

    @Put(':id/lock')
    @ApiBody({ type: LockTenantDto })
    @ApiOkResponse({ type: TenantDto })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto))
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    async lock(
        @Param('id') id: string,
        @Body() dto: LockTenantDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string
    ): Promise<TenantEntity> {
        const validatedDto = await Utils.validateDtoOrFail(LockTenantDto, dto);
        return await this.tenantService.lock(id, validatedDto, user.id, user.identityId, ipAddress);
    }

    @Put(':id/unlock')
    @ApiBody({ type: UnlockTenantDto })
    @ApiOkResponse({ type: TenantDto })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto))
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    async unlock(
        @Param('id') id: string,
        @Body() unlockTenantDto: UnlockTenantDto,
        @CurrentUser() user: CurrentUserType,
        @Ip() ipAddress: string
    ): Promise<TenantEntity> {
        return await this.tenantService.unlock(id, unlockTenantDto, user.id, user.identityId, ipAddress);
    }

    @Delete(':id')
    @ApiOkResponse({ type: DeleteResult })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.DELETE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    async remove(@Param('id') id: string): Promise<DeleteResult> {
        return await this.tenantService.remove(id);
    }
}
