import { Body, Controller, HttpCode, HttpStatus, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AllowServices } from '@common/auth/require-permission.decorator';
import { ServiceCapability } from '@common/auth/authz/keto-tuples';

import { TenantResponse, UpdateVerificationStatusDto } from '@domains/tenant';

import { TenantService } from './tenant.service';

/**
 * Internal company-verification callback.
 * The workflow service's `account_verification` Temporal workflow calls this (with a service
 * token) to apply its decision, updating verification_status. See NOTE.md for the contract.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller('internal/tenants')
export class InternalTenantVerificationController {
    constructor(private readonly tenantService: TenantService) {}

    @ApiOkResponse({ type: TenantResponse })
    @AllowServices(ServiceCapability.TENANT_VERIFICATION_WRITE)
    @HttpCode(HttpStatus.OK)
    @Patch(':id/verification')
    async updateVerificationStatus(@Param('id') tenantId: string, @Body() dto: UpdateVerificationStatusDto): Promise<TenantResponse> {
        return this.tenantService.setVerificationStatus(tenantId, dto.status, dto.reason, dto.reviewedBy);
    }
}
