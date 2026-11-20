import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IAuthenticatedUser } from '@app/types';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { PlatformAdmin } from '@common/auth/require-permission.decorator';
import {
    AdminVerificationDetailResponse,
    AdminVerificationQueryDto,
    AdminVerificationResponse,
    VerificationDecisionDto
} from '@domains/verification';

import { AdminVerificationService } from './admin-verification.service';

/**
 * Super Admin review of company verifications (US1.6.2, E1 D15), from the platform console. The default list is what
 * awaiting a decision (`pending_review`). The acting staff member (`staff:{identity}`) is the reviewer of record.
 */
@ApiTags('Admin - Verifications')
@ApiBearerAuth()
@PlatformAdmin()
@Controller({ path: 'admin/verifications', version: '1' })
export class AdminVerificationController {
    constructor(private readonly verifications: AdminVerificationService) {}

    @Get()
    @ApiOperation({ summary: 'Company verifications awaiting a decision (pending_review by default)' })
    @ApiOkResponse({ type: [AdminVerificationResponse] })
    async list(@Query() query: AdminVerificationQueryDto): Promise<AdminVerificationResponse[]> {
        return this.verifications.list(query.status);
    }

    @Get(':id')
    @ApiOperation({ summary: "One verification with the provider's reference and result (audit-logged)" })
    @ApiOkResponse({ type: AdminVerificationDetailResponse })
    async detail(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<AdminVerificationDetailResponse> {
        return this.verifications.detail(id, user.userId);
    }

    @Post(':id/approve')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify the company, with a reason for the audit trail' })
    @ApiOkResponse({ type: AdminVerificationResponse })
    async approve(
        @Param('id') id: string,
        @Body() dto: VerificationDecisionDto,
        @CurrentUser() user: IAuthenticatedUser
    ): Promise<AdminVerificationResponse> {
        return this.verifications.approve(id, user.userId, dto.reason);
    }

    @Post(':id/reject')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reject the company, with a reason the Owner sees' })
    @ApiOkResponse({ type: AdminVerificationResponse })
    async reject(
        @Param('id') id: string,
        @Body() dto: VerificationDecisionDto,
        @CurrentUser() user: IAuthenticatedUser
    ): Promise<AdminVerificationResponse> {
        return this.verifications.reject(id, user.userId, dto.reason);
    }
}
