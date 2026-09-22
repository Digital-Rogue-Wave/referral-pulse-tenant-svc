import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { TenantService } from '../tenant/tenant.service';
import { StripeWebhookService } from '../billing/stripe-webhook.service';

import { WebhookController } from './webhook.controller';
import { OryWebhookGuard } from './ory-webhook.guard';

describe('Ory web hooks', () => {
    let controller: WebhookController;
    let prisma: MockProxy<DatabaseService>;
    let tenantService: MockProxy<TenantService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        tenantService = mock<TenantService>();
        txEventEmitter = mock<TransactionEventEmitterService>();
        prisma.user = { findFirst: jest.fn(), update: jest.fn() } as never;
        prisma.invitation = { findFirst: jest.fn() } as never;
        (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WebhookController,
                { provide: TenantService, useValue: tenantService },
                { provide: StripeWebhookService, useValue: mock<StripeWebhookService>() },
                { provide: DatabaseService, useValue: prisma },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter }
            ]
        })
            .overrideGuard(OryWebhookGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get(WebhookController);
    });

    describe('given a Kratos after-login hook', () => {
        it('then records the login time and emits user.logged_in for a platform user', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });

            const result = await controller.handleOryLogin({ identity: { id: 'kratos-1' }, authentication_method: 'password' });

            expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { lastLoginAt: expect.any(Date) } });
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith(
                'user.logged_in',
                expect.objectContaining({ aggregateId: 'user-1', tenantId: 'tenant-1', authMethod: 'password' })
            );
            expect(result).toEqual({ status: 'ok' });
        });

        it('then does nothing for an identity with no membership', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

            await controller.handleOryLogin({ identity: { id: 'kratos-unknown' } });

            expect(prisma.user.update).not.toHaveBeenCalled();
            expect(txEventEmitter.emitAfterCommit).not.toHaveBeenCalled();
        });
    });

    describe('given a Kratos after-registration hook', () => {
        const signup = {
            identity: { id: 'kratos-9', traits: { email: 'Owner@Acme.io', firstname: 'Ada', lastname: 'Lovelace', tenantName: 'Acme' } }
        };

        it('then onboards a tenant owned by that identity, idempotently for replayed hooks', async () => {
            (prisma.invitation.findFirst as jest.Mock).mockResolvedValue(null);
            tenantService.create.mockResolvedValue({ id: 'tenant-9' } as never);

            const result = await controller.handleOrySignup(signup);

            expect(tenantService.create).toHaveBeenCalledWith(
                { name: 'Acme' },
                { identityId: 'kratos-9', email: 'Owner@Acme.io', name: 'Ada Lovelace' },
                { onExisting: 'return' }
            );
            expect(result).toEqual({ status: 'ok', tenant_created: true, tenant_id: 'tenant-9' });
        });

        it('then creates no tenant when the address has a pending invitation — the invitee joins the inviting tenant instead', async () => {
            (prisma.invitation.findFirst as jest.Mock).mockResolvedValue({ id: 'inv-1' });

            const result = await controller.handleOrySignup(signup);

            expect(tenantService.create).not.toHaveBeenCalled();
            expect(result).toEqual({ status: 'ok', tenant_created: false, reason: 'invitation_pending' });
        });

        it('then rejects a payload without an identity id or email', async () => {
            await expect(controller.handleOrySignup({ identity: { traits: {} } })).rejects.toBeInstanceOf(BaseException);
            expect(tenantService.create).not.toHaveBeenCalled();
        });
    });
});

describe('OryWebhookGuard', () => {
    const secret = 'k'.repeat(40);
    const config = { getOrThrow: () => secret } as unknown as ConfigService;
    const contextWith = (header: string | undefined): ExecutionContext =>
        ({ switchToHttp: () => ({ getRequest: () => ({ header: () => header }) }) }) as unknown as ExecutionContext;

    it('admits the configured shared secret', () => {
        expect(new OryWebhookGuard(config).canActivate(contextWith(secret))).toBe(true);
    });

    it.each([undefined, '', 'wrong', `${secret}x`])('rejects %p', (presented) => {
        expect(() => new OryWebhookGuard(config).canActivate(contextWith(presented))).toThrow(BaseException);
    });
});
