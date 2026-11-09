import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { AllowUnpaidTenant } from '@common/auth/tenant-access.guard';
import { CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';
import { AppLoggerService } from '@common/logging/app-logger.service';

import {
    SubscriptionCheckoutDto,
    SubscriptionCheckoutResponseDto,
    SubscriptionStatusDto,
    SubscriptionUpgradeRequestDto,
    SubscriptionUpgradePreviewResponseDto,
    SubscriptionDowngradeRequestDto,
    SubscriptionCancelRequestDto,
    InvoiceDto,
    UpcomingInvoiceDto,
    UsageSummaryDto
} from '@domains/billing';

import { BillingService } from './billing.service';

@ApiTags('billings')
@ApiBearerAuth()
@AllowUnpaidTenant()
@Controller({ path: 'billing', version: '1' })
export class BillingController {
    constructor(
        private readonly billingService: BillingService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(BillingController.name);
    }

    @ApiOkResponse({ type: SubscriptionStatusDto })
    @RequirePermission('billing:read')
    @HttpCode(HttpStatus.OK)
    @Get('plan')
    async getCurrentSubscription(): Promise<SubscriptionStatusDto> {
        return await this.billingService.getCurrentSubscription();
    }

    @ApiOkResponse({ type: SubscriptionCheckoutResponseDto })
    @RequirePermission('billing:write')
    @HttpCode(HttpStatus.OK)
    @Post('subscription/checkout')
    async subscriptionCheckout(@Body() dto: SubscriptionCheckoutDto): Promise<SubscriptionCheckoutResponseDto> {
        return await this.billingService.subscriptionCheckout(dto.plan, dto.couponCode);
    }

    @ApiOkResponse({ type: SubscriptionUpgradePreviewResponseDto })
    @RequirePermission('billing:read')
    @HttpCode(HttpStatus.OK)
    @Post('subscription/upgrade/preview')
    async previewSubscriptionUpgrade(@Body() dto: SubscriptionUpgradeRequestDto): Promise<SubscriptionUpgradePreviewResponseDto> {
        return await this.billingService.previewSubscriptionUpgrade(dto.targetPlan);
    }

    /** 202: Stripe took the upgrade; the plan changes when its webhook arrives (US1.8.2 F10). */
    @ApiAcceptedResponse({ type: SubscriptionStatusDto })
    @RequirePermission('billing:write')
    @HttpCode(HttpStatus.ACCEPTED)
    @Post('subscription/upgrade')
    async upgradeSubscription(@Body() dto: SubscriptionUpgradeRequestDto): Promise<SubscriptionStatusDto> {
        return await this.billingService.upgradeSubscription(dto.targetPlan);
    }

    @ApiOkResponse({ type: SubscriptionStatusDto })
    @RequirePermission('billing:write')
    @HttpCode(HttpStatus.OK)
    @Post('subscription/downgrade')
    async downgradeSubscription(@Body() dto: SubscriptionDowngradeRequestDto): Promise<SubscriptionStatusDto> {
        return await this.billingService.downgradeSubscription(dto.targetPlan);
    }

    @ApiOkResponse({ type: SubscriptionStatusDto })
    @RequirePermission('billing:write')
    @HttpCode(HttpStatus.OK)
    @Post('subscription/downgrade/cancel')
    async cancelPendingDowngrade(): Promise<SubscriptionStatusDto> {
        return await this.billingService.cancelPendingDowngrade();
    }

    @ApiOkResponse({ type: SubscriptionStatusDto })
    @RequirePermission('billing:write')
    @HttpCode(HttpStatus.OK)
    @Post('subscription/cancel')
    async cancelSubscription(@Body() dto: SubscriptionCancelRequestDto): Promise<SubscriptionStatusDto> {
        return await this.billingService.cancelSubscription(dto);
    }

    @ApiOkResponse({ type: SubscriptionStatusDto })
    @RequirePermission('billing:write')
    @HttpCode(HttpStatus.OK)
    @Post('subscription/reactivate')
    async reactivateSubscription(): Promise<SubscriptionStatusDto> {
        return await this.billingService.reactivateSubscription();
    }

    @ApiOkResponse({ description: 'A page of invoices, newest first', type: CursorPage })
    @RequirePermission('billing:read')
    @HttpCode(HttpStatus.OK)
    @Get('invoices')
    async listInvoices(@Query() query: ListQueryDto): Promise<CursorPage<InvoiceDto>> {
        return await this.billingService.listInvoices(query);
    }

    @ApiOkResponse({ description: 'One-time URL of the Stripe Customer Portal' })
    @RequirePermission('billing:write')
    @HttpCode(HttpStatus.OK)
    @Post('portal-session')
    async createPortalSession(): Promise<{ url: string }> {
        return await this.billingService.createPortalSession();
    }

    @ApiOkResponse({ type: UpcomingInvoiceDto })
    @RequirePermission('billing:read')
    @HttpCode(HttpStatus.OK)
    @Get('invoices/upcoming')
    async getUpcomingInvoice(): Promise<UpcomingInvoiceDto> {
        return await this.billingService.getUpcomingInvoice();
    }

    @ApiOkResponse({ type: UsageSummaryDto })
    @RequirePermission('billing:read')
    @HttpCode(HttpStatus.OK)
    @Get('usage')
    async getUsageSummary(): Promise<UsageSummaryDto> {
        return await this.billingService.getUsageSummary();
    }
}
