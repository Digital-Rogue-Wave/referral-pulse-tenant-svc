import { NotFoundException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';

import { CurrencyController } from '@common/currency/currency.controller';
import { CurrencyService } from '@common/currency/currency.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DomainMetrics } from '@common/monitoring/domain-metrics.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { DatabaseService } from '@app/database/database.service';
import type { IAuthenticatedUser } from '@app/types';
import { RoleEnum } from '@common/enums/role.enum';

import { ApiKeyController } from './api-key/api-key.controller';
import { ApiKeyService } from './api-key/api-key.service';
import { AuditLogController } from './audit-log/audit-log.controller';
import { AuditLogService } from './audit-log/audit-log.service';
import { BillingController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { InternalTenantStatusController } from './billing/internal-tenant-status.controller';
import { PlanAdminController } from './billing/plan-admin.controller';
import { PlanLimitService } from './billing/plan-limit.service';
import { PlanPublicController } from './billing/plan-public.controller';
import { PlanService } from './billing/plan.service';
import { StripeWebhookService } from './billing/stripe-webhook.service';
import { UsageInternalController } from './billing/usage-internal.controller';
import { InvitationController, PublicInvitationController } from './invitation/invitation.controller';
import { InvitationService } from './invitation/invitation.service';
import { AdminTenantController } from './tenant/agnostic/admin-tenant.controller';
import { AwareTenantController } from './tenant/aware/aware-tenant.controller';
import { TenantStatsService } from './tenant/aware/tenant-stats.service';
import { TenantService } from './tenant/tenant.service';
import { UserNotificationPreferenceController } from './tenant-setting/user-notification-preference.controller';
import { UserNotificationPreferenceService } from './tenant-setting/user-notification-preference.service';
import { OperatorContactController } from './users/operator-contact.controller';
import { OperatorErasureController } from './users/operator-erasure.controller';
import { OperatorErasureService } from './users/operator-erasure.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { WebhooksController } from './webhook/webhooks.controller';

const USER: IAuthenticatedUser = { userId: 'u1', tenantId: 't1', source: 'dashboard' };

/** Calls every listed controller method and expects the named service method to receive the call. */
function expectDelegation(calls: Array<[() => unknown, jest.Mock | unknown]>) {
    for (const [call, target] of calls) {
        call();
        expect(target).toHaveBeenCalled();
    }
}

describe('Controllers delegate to their services', () => {
    it('invitations', () => {
        const service = mock<InvitationService>();
        const controller = new InvitationController(service);
        const publicController = new PublicInvitationController(service);
        expectDelegation([
            [() => controller.create({ email: 'a@b.io', role: RoleEnum.OPERATOR }, USER), service.create],
            [() => controller.findAll({}), service.findAll],
            [() => controller.resend('inv1', USER), service.resend],
            [() => controller.revoke('inv1', USER), service.revoke],
            [() => publicController.getByToken('tok'), service.getByToken],
            [() => publicController.accept('tok', USER), service.accept]
        ]);
    });

    it('API keys', () => {
        const service = mock<ApiKeyService>();
        const controller = new ApiKeyController(service);
        expectDelegation([
            [() => controller.create({ label: 'CI' }, USER), service.create],
            [() => controller.findAll({}), service.findAll],
            [() => controller.findOne('k1'), service.findById],
            [() => controller.update('k1', { label: 'x' }, USER), service.update],
            [() => controller.rotate('k1', USER), service.rotate],
            [() => controller.delete('k1', { reason: 'leak' }, USER), service.delete]
        ]);
    });

    it('billing', () => {
        const service = mock<BillingService>();
        const controller = new BillingController(service, mock<AppLoggerService>());
        expectDelegation([
            [() => controller.getCurrentSubscription(), service.getCurrentSubscription],
            [() => controller.subscriptionCheckout({ plan: 'Starter' } as never), service.subscriptionCheckout],
            [() => controller.previewSubscriptionUpgrade({ targetPlan: 'Growth' } as never), service.previewSubscriptionUpgrade],
            [() => controller.upgradeSubscription({ targetPlan: 'Growth' } as never), service.upgradeSubscription],
            [() => controller.downgradeSubscription({ targetPlan: 'Starter' } as never), service.downgradeSubscription],
            [() => controller.cancelPendingDowngrade(), service.cancelPendingDowngrade],
            [() => controller.cancelSubscription({}), service.cancelSubscription],
            [() => controller.reactivateSubscription(), service.reactivateSubscription],
            [() => controller.createPaymentMethodSetupIntent(), service.createPaymentMethodSetupIntent],
            [() => controller.listPaymentMethods(), service.listPaymentMethods],
            [() => controller.deletePaymentMethod('pm1'), service.deletePaymentMethod],
            [() => controller.setDefaultPaymentMethod('pm1'), service.setDefaultPaymentMethod],
            [() => controller.listInvoices({}), service.listInvoices],
            [() => controller.createPortalSession(), service.createPortalSession],
            [() => controller.getUpcomingInvoice(), service.getUpcomingInvoice],
            [() => controller.getUsageSummary(), service.getUsageSummary]
        ]);
    });

    it('plans', () => {
        const service = mock<PlanService>();
        const admin = new PlanAdminController(service, mock<AppLoggerService>());
        expectDelegation([
            [() => admin.create({ name: 'x' } as never), service.create],
            [() => admin.listPlans({}), service.findPage],
            [() => admin.findOne('p1'), service.findOne],
            [() => admin.update('p1', {} as never), service.update],
            [() => admin.delete('p1'), service.softDelete],
            [() => new PlanPublicController(service).listPublicPlans(), service.getPublicPlansCached]
        ]);
    });

    it('tenants (tenant-scoped and platform-admin)', () => {
        const service = mock<TenantService>();
        const stats = mock<TenantStatsService>();
        const aware = new AwareTenantController(service, stats);
        const admin = new AdminTenantController(service);
        expectDelegation([
            [() => aware.checkSubdomain('acme'), service.checkSubdomainAvailability],
            [() => aware.getStats(), stats.getStats],
            [() => aware.getDomainStatus(), service.getDomainStatus],
            [() => aware.getProfile(), service.getProfile],
            [() => aware.verifyCustomDomain(), service.verifyCustomDomain],
            [() => aware.transferOwnership({ newOwnerId: 'u2' }, USER), service.transferOwnership],
            [() => aware.scheduleDeletion({}, USER), service.scheduleDeletion],
            [() => aware.cancelDeletion({}, USER), service.cancelDeletion],
            [() => aware.lock({ reason: 'r', password: 'p' }, USER), service.lock],
            [() => aware.unlock({ password: 'p' }, USER), service.unlock],
            [() => admin.suspend('t2', { reason: 'fraud' }), service.suspend],
            [() => admin.unsuspend('t2'), service.unsuspend],
            [() => admin.lock('t2', { reason: 'r', lockUntil: '2026-10-01T00:00:00Z' }, USER), service.lockAsAdmin],
            [() => admin.unlock('t2', USER), service.unlockAsAdmin]
        ]);
    });

    it('users, preferences, audit log, currencies and the Stripe webhook', () => {
        const users = mock<UsersService>();
        const controller = new UsersController(users);
        const preferences = mock<UserNotificationPreferenceService>();
        const prefs = new UserNotificationPreferenceController(preferences);
        const audit = mock<AuditLogService>();
        const currencies = mock<CurrencyService>();
        const currency = new CurrencyController(currencies);
        const webhooks = mock<StripeWebhookService>();
        expectDelegation([
            [() => controller.getMe(USER), users.getMe],
            [() => controller.add({ kratosIdentityId: 'k', role: RoleEnum.VIEWER }, USER), users.addUser],
            [() => controller.findAll({}), users.findAll],
            [() => controller.findOne('u2'), users.findById],
            [() => controller.updateRole('u2', { role: RoleEnum.ADMIN }, USER), users.updateRole],
            [() => controller.remove('u2', USER), users.remove],
            [() => prefs.findMyPreferences(), preferences.findMyPreferences],
            [() => prefs.updateMyPreferences({} as never), preferences.updateMyPreferences],
            [() => prefs.deleteMyPreferences(), preferences.deleteMyPreferences],
            [() => new AuditLogController(audit).list({}), audit.list],
            [() => currency.list(), currencies.catalog],
            [() => currency.createCurrency({} as never), currencies.create],
            [() => currency.updateCurrency('c1', {} as never), currencies.updateById],
            [() => new WebhooksController(webhooks).handleStripeWebhook('sig', { rawBody: Buffer.from('{}') } as never), webhooks.handle]
        ]);
    });
});

describe('Internal endpoints', () => {
    it('operator erasure records the receipt status in the metrics', async () => {
        const erasure = mock<OperatorErasureService>();
        erasure.erase.mockResolvedValue({ status: 'completed' } as never);
        const metrics = mock<DomainMetrics>();
        await new OperatorErasureController(erasure, metrics).eraseOperator({ dsrId: 'd1', userId: 'u1'.padEnd(26, '0') });
        expect(metrics.erasure).toHaveBeenCalledWith('completed');
    });

    it('usage metering is atomic against the plan (increment) and releases on decrement', async () => {
        const planLimits = mock<PlanLimitService>();
        planLimits.consume.mockResolvedValue(3);
        planLimits.release.mockResolvedValue(2);
        const controller = new UsageInternalController(planLimits, mock<TenantContextService>());

        await expect(controller.incrementUsage('t1', { metric: 'email_sends', amount: 1 })).resolves.toMatchObject({
            metric: 'email_sends',
            currentUsage: 3
        });
        await expect(controller.decrementUsage('t1', { metric: 'email_sends' })).resolves.toMatchObject({ currentUsage: 2 });
        expect(planLimits.consume).toHaveBeenCalledWith('t1', 'email_sends', 1);
    });

    it('tenant status and entitlements are 404 for an unknown tenant', async () => {
        const prisma = { tenant: { findUnique: jest.fn() }, billing: { findUnique: jest.fn().mockResolvedValue(null) } };
        const planLimits = mock<PlanLimitService>();
        const controller = new InternalTenantStatusController(prisma as unknown as DatabaseService, planLimits);

        prisma.tenant.findUnique.mockResolvedValue({ status: 'active', paymentStatus: 'past_due', trialStartedAt: null, trialEndsAt: null });
        await expect(controller.getTenantStatus('t1')).resolves.toMatchObject({
            tenantStatus: 'active',
            paymentStatus: 'past_due',
            plan: 'Free',
            subscriptionStatus: 'none'
        });

        prisma.tenant.findUnique.mockResolvedValue(null);
        await expect(controller.getTenantStatus('nope')).rejects.toBeInstanceOf(NotFoundException);
        planLimits.entitlementsOf.mockResolvedValue(null);
        await expect(controller.getEntitlements('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('operator contacts', () => {
        const row = { id: 'u1', tenantId: 't1', email: 'ada@acme.io', name: 'Ada', role: 'OWNER' };
        const prisma = { user: { findFirst: jest.fn(), findMany: jest.fn() } };
        const controller = new OperatorContactController(prisma as unknown as DatabaseService);

        it('returns a live operator’s address, never a removed or erased one', async () => {
            prisma.user.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce(null);

            await expect(controller.contactOf('t1', 'u1')).resolves.toEqual({
                userId: 'u1',
                tenantId: 't1',
                email: 'ada@acme.io',
                name: 'Ada',
                role: 'owner'
            });
            expect(prisma.user.findFirst.mock.calls[0]![0].where).toEqual({ id: 'u1', tenantId: 't1', deletedAt: null, status: 'active' });
            await expect(controller.contactOf('t1', 'gone')).rejects.toBeInstanceOf(NotFoundException);
        });

        it('lists contacts by role, e.g. the Owner for billing mail', async () => {
            prisma.user.findMany.mockResolvedValue([row]);

            await expect(controller.contactsOf('t1', { role: RoleEnum.OWNER })).resolves.toHaveLength(1);
            expect(prisma.user.findMany.mock.calls[0]![0].where).toEqual({ tenantId: 't1', deletedAt: null, status: 'active', role: 'OWNER' });
        });
    });
});
