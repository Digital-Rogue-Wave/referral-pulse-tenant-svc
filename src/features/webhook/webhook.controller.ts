import { Controller, Post, Body, Headers, UnauthorizedException, Req } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { ConfigService } from '@nestjs/config';
import { Public } from '@common/auth/public.decorator';
import { BillingService } from '../billing/billing.service';
import { Idempotent, IdempotencyScope } from '@common/idempotency';
import { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Webhooks')
@Controller({ path: 'webhook', version: '1' })
@Public()
export class WebhookController {
    constructor(
        private readonly tenantService: TenantService,
        private readonly configService: ConfigService,
        private readonly billingService: BillingService,
    ) {}

    @Post('ory/signup')
    @Idempotent({ scope: IdempotencyScope.Global, ttl: 3600 })
    async handleOrySignup(@Headers('x-ory-api-key') apiKey: string, @Body() body: Record<string, unknown>) {
        const configuredApiKey = this.configService.getOrThrow<string>('ORY_WEBHOOK_API_KEY', { infer: true });
        if (configuredApiKey && apiKey !== configuredApiKey) {
            throw new UnauthorizedException('Invalid API key');
        }

        // Assuming body.identity.traits contains the user info
        // Adjust based on actual Ory Kratos identity schema
        const identity = body.identity as Record<string, unknown> | undefined;
        const source = identity || body;
        const traits = source.traits as Record<string, unknown>;
        const userId = (identity ? identity.id : body.id) as string;

        // We might want to use company name as tenant name, or user's name if company not present
        const name = traits.name as Record<string, unknown> | undefined;
        const tenantName =
            (traits.company_name as string) || (name ? `${name.first} ${name.last}` : undefined) || 'My Organization';

        await this.tenantService.create({
            name: tenantName,
            ownerId: userId,
        });

        return { status: 'ok' };
    }

    @Post('stripe')
    async handleStripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
        await this.billingService.handleStripeWebhook(req.rawBody ?? req.body, signature);
        return { received: true };
    }
}
