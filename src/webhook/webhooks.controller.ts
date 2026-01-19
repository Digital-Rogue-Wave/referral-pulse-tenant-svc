import { Controller, Headers, Post, Req, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@mod/common/auth/jwt-auth.guard';
import { BillingService } from '../billing/billing.service';
import { Request } from 'express';

@ApiTags('Webhooks')
@Controller({ path: 'webhooks', version: VERSION_NEUTRAL })
@Public()
export class WebhooksController {
    constructor(private readonly billingService: BillingService) {}

    @Post('stripe')
    async handleStripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
        await this.billingService.handleStripeWebhook((req as any).rawBody ?? req.body, signature);
        return { received: true };
    }
}
