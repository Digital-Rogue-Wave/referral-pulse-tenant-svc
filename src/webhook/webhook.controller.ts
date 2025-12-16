import { Controller, Post, Body, Headers, UnauthorizedException, Req } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { ConfigService } from '@nestjs/config';
import { Public } from '@mod/common/auth/jwt-auth.guard';
import { BillingService } from '../billing/billing.service';
import { Request } from 'express';

@Controller({ path: 'webhook', version: '1' })
@Public()
export class WebhookController {
    constructor(
        private readonly tenantService: TenantService,
        private readonly configService: ConfigService,
        private readonly billingService: BillingService
    ) {}

    @Post('ory/signup')
    async handleOrySignup(@Headers('x-ory-api-key') apiKey: string, @Body() body: any) {
        const configuredApiKey = this.configService.getOrThrow<string>('ORY_WEBHOOK_API_KEY', { infer: true });
        if (configuredApiKey && apiKey !== configuredApiKey) {
            throw new UnauthorizedException('Invalid API key');
        }

        // Assuming body.identity.traits contains the user info
        // Adjust based on actual Ory Kratos identity schema
        const { traits, id: userId } = body.identity || body;

        // We might want to use company name as tenant name, or user's name if company not present
        const tenantName = traits.company_name || traits.name?.first + ' ' + traits.name?.last || 'My Organization';

        await this.tenantService.create({
            name: tenantName,
            ownerId: userId
        });

        return { status: 'ok' };
    }

    @Post('stripe')
    async handleStripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
        await this.billingService.handleStripeWebhook((req as any).rawBody ?? req.body, signature);
        return { received: true };
    }
}
