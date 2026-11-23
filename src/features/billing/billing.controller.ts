import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { AllowUnpaidTenant } from '@common/auth/tenant-access.guard';
import { CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { SubscriptionCheckoutDto, SubscriptionCheckoutResponseDto, SubscriptionStatusDto, InvoiceDto } from '@domains/billing';

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
    @RequirePermission('tenant:billing')
    @HttpCode(HttpStatus.OK)
    @Get('plan')
    async getCurrentSubscription(): Promise<SubscriptionStatusDto> {
        return await this.billingService.getCurrentSubscription();
    }

    @ApiOkResponse({ type: SubscriptionCheckoutResponseDto })
    @RequirePermission('tenant:billing')
    @HttpCode(HttpStatus.OK)
    @Post('subscription/checkout')
    async subscriptionCheckout(@Body() dto: SubscriptionCheckoutDto): Promise<SubscriptionCheckoutResponseDto> {
        return await this.billingService.subscriptionCheckout(dto.plan, dto.couponCode);
    }

    @ApiOkResponse({ description: 'A page of invoices, newest first', type: CursorPage })
    @RequirePermission('tenant:billing')
    @HttpCode(HttpStatus.OK)
    @Get('invoices')
    async listInvoices(@Query() query: ListQueryDto): Promise<CursorPage<InvoiceDto>> {
        return await this.billingService.listInvoices(query);
    }

    @ApiOkResponse({ description: 'One-time URL of the Stripe Customer Portal' })
    @RequirePermission('tenant:billing')
    @HttpCode(HttpStatus.OK)
    @Post('portal-session')
    async createPortalSession(): Promise<{ url: string }> {
        return await this.billingService.createPortalSession();
    }
}
