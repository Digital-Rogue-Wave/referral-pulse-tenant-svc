import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { PaymentRequiredGuard } from './payment-required.guard';
import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { PaymentStatusEnum } from '@common/enums/billing.enum';

describe('PaymentRequiredGuard', () => {
    let guard: PaymentRequiredGuard;
    let prisma: MockProxy<DatabaseService>;
    let tenantContext: MockProxy<TenantContextService>;

    const contextFor = (method?: string): ExecutionContext =>
        ({
            switchToHttp: () => ({
                getRequest: () => (method ? { method } : undefined)
            })
        }) as ExecutionContext;

    const tenantWith = (paymentStatus: PaymentStatusEnum): void => {
        (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ paymentStatus });
    };

    const expectPaymentRequired = async (context: ExecutionContext): Promise<void> => {
        await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
        try {
            await guard.canActivate(context);
        } catch (e: any) {
            expect(e.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
            expect(e.getResponse().code).toBe('payment_required');
        }
    };

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        (prisma as any).tenant = { findUnique: jest.fn() };
        tenantContext = mock<TenantContextService>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PaymentRequiredGuard,
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantContextService, useValue: tenantContext }
            ]
        }).compile();

        guard = module.get<PaymentRequiredGuard>(PaymentRequiredGuard);
        tenantContext.getTenantId.mockReturnValue('tenant-123');
    });

    it('allows the request when no tenant context is available', async () => {
        tenantContext.getTenantId.mockReturnValue(undefined);

        await expect(guard.canActivate(contextFor('POST'))).resolves.toBe(true);
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when the tenant does not exist', async () => {
        (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

        try {
            await guard.canActivate(contextFor('GET'));
            fail('expected the guard to throw');
        } catch (e: any) {
            expect(e.getStatus()).toBe(HttpStatus.NOT_FOUND);
            expect(e.getResponse().code).toBe('tenant_not_found');
        }
    });

    describe('active', () => {
        it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('allows %s', async (method) => {
            tenantWith(PaymentStatusEnum.ACTIVE);
            await expect(guard.canActivate(contextFor(method))).resolves.toBe(true);
        });
    });

    describe('past_due — full access, the dashboard only shows a warning', () => {
        it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('allows %s', async (method) => {
            tenantWith(PaymentStatusEnum.PAST_DUE);
            await expect(guard.canActivate(contextFor(method))).resolves.toBe(true);
        });
    });

    describe('restricted — read-only tier', () => {
        it.each(['GET', 'HEAD', 'OPTIONS'])('allows the read method %s', async (method) => {
            tenantWith(PaymentStatusEnum.RESTRICTED);
            await expect(guard.canActivate(contextFor(method))).resolves.toBe(true);
        });

        it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects the mutating method %s with 402', async (method) => {
            tenantWith(PaymentStatusEnum.RESTRICTED);
            await expectPaymentRequired(contextFor(method));
        });

        it('treats a lower-case method as its upper-case equivalent', async () => {
            tenantWith(PaymentStatusEnum.RESTRICTED);
            await expectPaymentRequired(contextFor('post'));
        });

        it('allows non-HTTP execution contexts, which carry no method', async () => {
            tenantWith(PaymentStatusEnum.RESTRICTED);
            await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(true);
        });
    });

    describe('locked — no access at all', () => {
        it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s with 402', async (method) => {
            tenantWith(PaymentStatusEnum.LOCKED);
            await expectPaymentRequired(contextFor(method));
        });
    });

    it('scopes the lookup to the context tenant and to non-deleted tenants', async () => {
        tenantWith(PaymentStatusEnum.ACTIVE);

        await guard.canActivate(contextFor('GET'));

        expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
            where: { id: 'tenant-123', deletedAt: null },
            select: { paymentStatus: true }
        });
    });
});
