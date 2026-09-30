import { Controller, HttpCode, HttpStatus, Headers, Post, Req, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@common/auth/public.decorator';
import { RawWire } from '@common/http-contract/wire-case.interceptor';
import { StripeWebhookService } from '../billing/stripe-webhook.service';
import type { Request } from 'express';

@RawWire()
@ApiTags('Webhooks')
@Controller({ path: 'webhooks', version: VERSION_NEUTRAL })
@Public()
export class WebhooksController {
    constructor(private readonly stripeWebhooks: StripeWebhookService) {}

    @HttpCode(HttpStatus.OK)
    @Post('stripe')
    async handleStripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
        await this.stripeWebhooks.handle(req.rawBody ?? req.body, signature);
        return { received: true };
    }
}
