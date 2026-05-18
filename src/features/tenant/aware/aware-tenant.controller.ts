import {
    Controller,
    Get,
    Body,
    Put,
    HttpCode,
    HttpStatus,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiBody,
    ApiConsumes,
    ApiExtraModels,
    ApiOkResponse,
    ApiTags,
    getSchemaPath,
    ApiBearerAuth,
    ApiHeader,
} from '@nestjs/swagger';

import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation } from '@common/auth/keto.constants';
import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { ParseFormdataPipe } from '@common/pipes/parse-formdata.pipe';

import {
    TenantResponse,
    TenantProfileResponse,
    DomainStatusResponse,
    SubdomainAvailabilityResponse,
    DeletionScheduledResponse,
    UpdateTenantDto,
    TransferOwnershipDto,
    ScheduleDeletionDto,
    CancelDeletionDto,
    LockTenantDto,
    UnlockTenantDto,
    TenantStatsDto,
} from '@domains/tenant';

import { TenantService } from '../tenant.service';
import { TenantStatsService } from './tenant-stats.service';
import { TenantStatusGuard } from '../guards/tenant-status.guard';
import { TenantLockGuard } from '../guards/tenant-lock.guard';

@ApiTags('Aware Tenants')
@ApiHeader({
    name: 'tenant-id',
    required: true,
    description: 'Tenant-Id header',
    schema: { type: 'string' },
})
@ApiBearerAuth()
@UseGuards(TenantStatusGuard, TenantLockGuard)
@Controller({ path: 'tenants', version: '1' })
export class AwareTenantController {
    constructor(
        private readonly tenantService: TenantService,
        private readonly statsService: TenantStatsService,
    ) {}

    @Get('subdomain/check')
    @ApiOkResponse({
        description: 'Check if subdomain is available',
        type: SubdomainAvailabilityResponse,
    })
    @HttpCode(HttpStatus.OK)
    async checkSubdomain(@Query('subdomain') subdomain: string): Promise<SubdomainAvailabilityResponse> {
        return await this.tenantService.checkSubdomainAvailability(subdomain);
    }

    @Get('stats')
    @ApiOkResponse({
        description: 'Get dashboard stats for current tenant',
        type: TenantStatsDto,
    })
    @HttpCode(HttpStatus.OK)
    async getStats(): Promise<TenantStatsDto> {
        return await this.statsService.getStats();
    }

    @Get('custom-domain/status')
    @ApiOkResponse({
        description: 'Get custom domain verification status',
        type: DomainStatusResponse,
    })
    @HttpCode(HttpStatus.OK)
    async getDomainStatus(): Promise<DomainStatusResponse> {
        return await this.tenantService.getDomainStatus();
    }

    @Get('profile')
    @ApiOkResponse({ type: TenantProfileResponse })
    @HttpCode(HttpStatus.OK)
    async getProfile(): Promise<TenantProfileResponse> {
        return await this.tenantService.getProfile();
    }

    @Put()
    @ApiConsumes('multipart/form-data')
    @ApiExtraModels(UpdateTenantDto)
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                },
                data: {
                    $ref: getSchemaPath(UpdateTenantDto),
                },
            },
        },
    })
    @ApiOkResponse({ type: TenantResponse })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.UPDATE })
    @UseInterceptors(FileInterceptor('file'))
    @HttpCode(HttpStatus.OK)
    async update(
        @CurrentUser() user: IAuthenticatedUser,
        @Body('data', ParseFormdataPipe) data: UpdateTenantDto,
        @UploadedFile() file?: Express.Multer.File | Express.MulterS3.File,
    ): Promise<TenantResponse> {
        return await this.tenantService.update(data, user, file);
    }

    @Put('custom-domain/verify')
    @ApiOkResponse({
        description: 'Domain verified successfully',
        type: TenantResponse,
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    async verifyCustomDomain(): Promise<TenantResponse> {
        return await this.tenantService.verifyCustomDomain();
    }

    @Put('transfer-ownership')
    @ApiBody({ type: TransferOwnershipDto })
    @ApiOkResponse({ description: 'Ownership transferred successfully' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    async transferOwnership(@Body() dto: TransferOwnershipDto, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        return await this.tenantService.transferOwnership(dto, user);
    }

    @Put('schedule-deletion')
    @ApiBody({ type: ScheduleDeletionDto })
    @ApiOkResponse({
        description: 'Deletion scheduled successfully',
        type: DeletionScheduledResponse,
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.DELETE })
    @HttpCode(HttpStatus.OK)
    async scheduleDeletion(
        @Body() dto: ScheduleDeletionDto,
        @CurrentUser() user: IAuthenticatedUser,
    ): Promise<DeletionScheduledResponse> {
        return await this.tenantService.scheduleDeletion(dto, user);
    }

    @Put('cancel-deletion')
    @ApiBody({ type: CancelDeletionDto })
    @ApiOkResponse({ description: 'Deletion cancelled successfully' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    async cancelDeletion(@Body() dto: CancelDeletionDto, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        return await this.tenantService.cancelDeletion(dto, user);
    }

    @Put('lock')
    @ApiBody({ type: LockTenantDto })
    @ApiOkResponse({ type: TenantResponse })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    async lock(@Body() dto: LockTenantDto, @CurrentUser() user: IAuthenticatedUser): Promise<TenantResponse> {
        return await this.tenantService.lock(dto, user);
    }

    @Put('unlock')
    @ApiBody({ type: UnlockTenantDto })
    @ApiOkResponse({ type: TenantResponse })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    async unlock(@Body() dto: UnlockTenantDto, @CurrentUser() user: IAuthenticatedUser): Promise<TenantResponse> {
        return await this.tenantService.unlock(dto, user);
    }
}
