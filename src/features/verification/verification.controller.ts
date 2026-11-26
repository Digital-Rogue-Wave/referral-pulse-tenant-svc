import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IAuthenticatedUser } from '@app/types';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { CompanyVerificationResponse, VerificationSessionResponse } from '@domains/verification';

import { CompanyVerificationService } from './company-verification.service';

/**
 * The Owner's company verification (Product Spec R-INT-02, US1.6.3, E1 D15). The tenant is the one in the token.
 */
@ApiTags('Verification')
@ApiBearerAuth()
@Controller({ path: 'verification', version: '1' })
export class VerificationController {
    constructor(private readonly verifications: CompanyVerificationService) {}

    @Get()
    @RequirePermission('tenant:read')
    @ApiOperation({ summary: "The company's verification status and latest verification" })
    @ApiOkResponse({ type: CompanyVerificationResponse })
    async status(@CurrentUser() user: IAuthenticatedUser): Promise<CompanyVerificationResponse> {
        return this.verifications.status(user.tenantId);
    }

    @Post()
    @HttpCode(HttpStatus.OK)
    @RequirePermission('tenant:settings')
    @ApiOperation({ summary: "Open the KYB provider's verification session and get its link" })
    @ApiOkResponse({ type: VerificationSessionResponse })
    async open(@CurrentUser() user: IAuthenticatedUser): Promise<VerificationSessionResponse> {
        return this.verifications.open(user.tenantId, user.userId);
    }
}
