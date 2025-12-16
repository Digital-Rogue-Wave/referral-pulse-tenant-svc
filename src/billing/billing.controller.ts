import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoRelation } from '@mod/common/auth/keto.constants';
import { Utils } from '@mod/common/utils/utils';
import { BillingService } from './billing.service';
import { SubscriptionCheckoutDto } from './dto/subscription-checkout.dto';
import { SubscriptionCheckoutResponseDto } from './dto/subscription-checkout-response.dto';

@ApiTags('billings')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller({ path: 'billings', version: '1' })
export class BillingController {
    constructor(private readonly billingService: BillingService) {}

    @ApiOkResponse({ type: SubscriptionCheckoutResponseDto })
    // @UseGuards(KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.MANAGE_BILLING })
    @HttpCode(HttpStatus.OK)
    @Post('subscription/checkout')
    async subscriptionCheckout(@Body() dto: SubscriptionCheckoutDto): Promise<SubscriptionCheckoutResponseDto> {
        const validated = await Utils.validateDtoOrFail(SubscriptionCheckoutDto, dto);
        return await this.billingService.subscriptionCheckout(validated.plan);
    }
}
