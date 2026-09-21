import { Controller, Post, Body, Headers, HttpStatus, Req, UseGuards } from '@nestjs/common';

import { BaseException } from '@common/exceptions/base.exceptions';
import { InvitationStatusEnum } from '@common/enums/invitation.enum';
import { TenantService } from '../tenant/tenant.service';
import { Public } from '@common/auth/public.decorator';
import { BillingService } from '../billing/billing.service';
import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { UserLoggedInEvent } from '@domains/user';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';

import { RawWire } from '@common/http-contract/wire-case.interceptor';

import { OryWebhookGuard } from './ory-webhook.guard';

// Payloads are Ory's and Stripe's, not ours: keys are passed through untouched.
@RawWire()
@ApiTags('Webhooks')
@Controller({ path: 'webhook', version: '1' })
@Public()
export class WebhookController {
    constructor(
        private readonly tenantService: TenantService,
        private readonly billingService: BillingService,
        private readonly prisma: DatabaseService,
        private readonly txEventEmitter: TransactionEventEmitterService
    ) {}

    @UseGuards(OryWebhookGuard)
    @Post('ory/signup')
    async handleOrySignup(@Body() body: Record<string, unknown>) {
        const identity = (body.identity as Record<string, unknown> | undefined) ?? body;
        const identityId = identity.id as string | undefined;
        const traits = (identity.traits ?? {}) as Record<string, unknown>;
        const email = traits.email as string | undefined;
        if (!identityId || !email) {
            throw new BaseException('invalid_request', 'Signup payload has no identity id or email', HttpStatus.BAD_REQUEST);
        }

        // An invited operator joins the inviting tenant by accepting the invitation — no tenant of their own.
        const pendingInvitation = await this.prisma.invitation.findFirst({
            where: {
                email: { equals: email, mode: 'insensitive' },
                status: InvitationStatusEnum.PENDING,
                expiresAt: { gt: new Date() },
                deletedAt: null
            },
            select: { id: true }
        });
        if (pendingInvitation) {
            return { status: 'ok', tenant_created: false, reason: 'invitation_pending' };
        }

        const name = [traits.firstname, traits.lastname].filter((part) => typeof part === 'string' && part).join(' ') || null;
        const tenantName =
            (traits.tenantName as string) || ((traits.company as Record<string, unknown> | undefined)?.name as string) || name || 'My Organization';
        const tenant = await this.tenantService.create({ name: tenantName }, { identityId, email, name }, { onExisting: 'return' });
        return { status: 'ok', tenant_created: true, tenant_id: tenant.id };
    }

    @UseGuards(OryWebhookGuard)
    @Post('ory/login')
    async handleOryLogin(@Body() body: Record<string, unknown>) {
        const identity = body.identity as Record<string, unknown> | undefined;
        const kratosIdentityId = (identity ? identity.id : body.id) as string | undefined;
        if (!kratosIdentityId) {
            return { status: 'ok' };
        }
        const authMethod = (body.authentication_method as string) ?? 'password';

        // Resolve the platform user to scope the event to its tenant; identities with no membership are ignored.
        const user = await this.prisma.user.findFirst({ where: { kratosIdentityId, deletedAt: null }, select: { id: true, tenantId: true } });
        if (user) {
            await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
            this.txEventEmitter.emitAfterCommit('user.logged_in', new UserLoggedInEvent(user.id, user.tenantId, authMethod, user.id));
        }

        return { status: 'ok' };
    }

    @Post('stripe')
    async handleStripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
        await this.billingService.handleStripeWebhook(req.rawBody ?? req.body, signature);
        return { received: true };
    }
}
