import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { RequirePermission } from "@common/auth/require-permission.decorator";
import {
  KetoNamespace,
  KetoRelation,
  KetoResource,
} from "@common/auth/keto.constants";
import { Idempotent, IdempotencyScope } from "@common/idempotency";
import { AppLoggerService } from "@common/logging/app-logger.service";

import {
  SubscriptionCheckoutDto,
  SubscriptionCheckoutResponseDto,
  SubscriptionStatusDto,
  SubscriptionUpgradeRequestDto,
  SubscriptionUpgradePreviewResponseDto,
  SubscriptionDowngradeRequestDto,
  SubscriptionCancelRequestDto,
  PaymentMethodSetupResponseDto,
  PaymentMethodDto,
  InvoiceDto,
  UpcomingInvoiceDto,
  UsageSummaryDto,
} from "@domains/billing";

import { BillingService } from "./billing.service";

@ApiTags("billings")
@ApiBearerAuth()
@ApiHeader({
  name: "x-tenant-id",
  required: true,
  description: "Tenant-Id header",
  schema: { type: "string" },
})
@Controller({ path: "billings", version: "1" })
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(BillingController.name);
  }

  @ApiOkResponse({ type: SubscriptionStatusDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.READ,
  })
  @HttpCode(HttpStatus.OK)
  @Get("subscription")
  async getCurrentSubscription(): Promise<SubscriptionStatusDto> {
    return await this.billingService.getCurrentSubscription();
  }

  @ApiOkResponse({ type: SubscriptionCheckoutResponseDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.CREATE,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
  @HttpCode(HttpStatus.OK)
  @Post("subscription/checkout")
  async subscriptionCheckout(
    @Body() dto: SubscriptionCheckoutDto,
  ): Promise<SubscriptionCheckoutResponseDto> {
    return await this.billingService.subscriptionCheckout(
      dto.plan,
      dto.couponCode,
    );
  }

  @ApiOkResponse({ type: SubscriptionUpgradePreviewResponseDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.READ,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 300 })
  @HttpCode(HttpStatus.OK)
  @Post("subscription/upgrade/preview")
  async previewSubscriptionUpgrade(
    @Body() dto: SubscriptionUpgradeRequestDto,
  ): Promise<SubscriptionUpgradePreviewResponseDto> {
    return await this.billingService.previewSubscriptionUpgrade(dto.targetPlan);
  }

  @ApiOkResponse({ type: SubscriptionStatusDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.UPDATE,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
  @HttpCode(HttpStatus.OK)
  @Post("subscription/upgrade")
  async upgradeSubscription(
    @Body() dto: SubscriptionUpgradeRequestDto,
  ): Promise<SubscriptionStatusDto> {
    return await this.billingService.upgradeSubscription(dto.targetPlan);
  }

  @ApiOkResponse({ type: SubscriptionStatusDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.UPDATE,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
  @HttpCode(HttpStatus.OK)
  @Post("subscription/downgrade")
  async downgradeSubscription(
    @Body() dto: SubscriptionDowngradeRequestDto,
  ): Promise<SubscriptionStatusDto> {
    return await this.billingService.downgradeSubscription(dto.targetPlan);
  }

  @ApiOkResponse({ type: SubscriptionStatusDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.UPDATE,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
  @HttpCode(HttpStatus.OK)
  @Post("subscription/downgrade/cancel")
  async cancelPendingDowngrade(): Promise<SubscriptionStatusDto> {
    return await this.billingService.cancelPendingDowngrade();
  }

  @ApiOkResponse({ type: SubscriptionStatusDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.DELETE,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
  @HttpCode(HttpStatus.OK)
  @Post("subscription/cancel")
  async cancelSubscription(
    @Body() dto: SubscriptionCancelRequestDto,
  ): Promise<SubscriptionStatusDto> {
    return await this.billingService.cancelSubscription(dto);
  }

  @ApiOkResponse({ type: SubscriptionStatusDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.UPDATE,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
  @HttpCode(HttpStatus.OK)
  @Post("subscription/reactivate")
  async reactivateSubscription(): Promise<SubscriptionStatusDto> {
    return await this.billingService.reactivateSubscription();
  }

  @ApiOkResponse({ type: PaymentMethodSetupResponseDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.CREATE,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
  @HttpCode(HttpStatus.OK)
  @Post("payment-methods")
  async createPaymentMethodSetupIntent(): Promise<PaymentMethodSetupResponseDto> {
    return await this.billingService.createPaymentMethodSetupIntent();
  }

  @ApiOkResponse({ type: PaymentMethodDto, isArray: true })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.READ,
  })
  @HttpCode(HttpStatus.OK)
  @Get("payment-methods")
  async listPaymentMethods(): Promise<PaymentMethodDto[]> {
    return await this.billingService.listPaymentMethods();
  }

  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.DELETE,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete("payment-methods/:id")
  async deletePaymentMethod(@Param("id") id: string): Promise<void> {
    await this.billingService.deletePaymentMethod(id);
  }

  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.UPDATE,
  })
  @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("payment-methods/:id/default")
  async setDefaultPaymentMethod(@Param("id") id: string): Promise<void> {
    await this.billingService.setDefaultPaymentMethod(id);
  }

  @ApiOkResponse({ type: InvoiceDto, isArray: true })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.READ,
  })
  @HttpCode(HttpStatus.OK)
  @Get("invoices")
  async listInvoices(): Promise<InvoiceDto[]> {
    return await this.billingService.listInvoices();
  }

  @ApiOkResponse({ type: UpcomingInvoiceDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.READ,
  })
  @HttpCode(HttpStatus.OK)
  @Get("invoices/upcoming")
  async getUpcomingInvoice(): Promise<UpcomingInvoiceDto> {
    return await this.billingService.getUpcomingInvoice();
  }

  @ApiOkResponse({ type: UsageSummaryDto })
  @RequirePermission({
    namespace: KetoNamespace.TENANT,
    object: KetoResource.BILLING,
    relation: KetoRelation.READ,
  })
  @HttpCode(HttpStatus.OK)
  @Get("usage")
  async getUsageSummary(): Promise<UsageSummaryDto> {
    return await this.billingService.getUsageSummary();
  }
}
