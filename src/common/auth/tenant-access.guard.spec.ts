import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mock } from 'jest-mock-extended';

import type { IAuthenticatedUser } from '@app/types';
import { IS_PUBLIC_KEY } from '@app/types';

import { PaymentStatusEnum } from '@common/enums/billing.enum';
import { BaseException } from '@common/exceptions/base.exceptions';
import { DatabaseService } from '@app/database/database.service';
import { TenantStatus } from '@domains/tenant/tenant.types';

import { ALLOW_LOCKED_TENANT_KEY } from './require-permission.decorator';
import { ALLOW_UNPAID_TENANT_KEY, TenantAccessGuard } from './tenant-access.guard';

const member: IAuthenticatedUser = { userId: 'user-1', tenantId: 'tenant-1', source: 'dashboard' };

describe('TenantAccessGuard — tenant access tiers', () => {
    const run = async (opts: {
        tenant?: Partial<{ status: string; paymentStatus: string; deletedAt: Date | null }> | null;
        method?: string;
        metadata?: Record<string, unknown>;
        user?: IAuthenticatedUser;
    }): Promise<boolean | BaseException> => {
        const prisma = mock<DatabaseService>();
        const defaults = { status: TenantStatus.ACTIVE, paymentStatus: PaymentStatusEnum.ACTIVE, deletedAt: null, lockedAt: null, lockUntil: null };
        const row = opts.tenant === null ? null : { ...defaults, ...opts.tenant };
        const findUnique = jest.fn().mockResolvedValue(row);
        (prisma as unknown as { tenant: unknown }).tenant = { findUnique };
        const reflector = { getAllAndOverride: (key: string) => opts.metadata?.[key] } as unknown as Reflector;
        const context = {
            getHandler: () => undefined,
            getClass: () => undefined,
            switchToHttp: () => ({ getRequest: () => ({ user: opts.user ?? member, method: opts.method ?? 'GET' }) })
        } as unknown as ExecutionContext;
        return new TenantAccessGuard(reflector, prisma).canActivate(context).catch((error: BaseException) => error);
    };

    const expectRefused = (result: boolean | BaseException, status: HttpStatus, code: string): void => {
        expect(result).toBeInstanceOf(BaseException);
        expect((result as BaseException).getStatus()).toBe(status);
        expect((result as BaseException).getCode()).toBe(code);
    };

    it('reads the tenant from the verified principal — so the tiers apply at guard time', async () => {
        expect(await run({})).toBe(true);
    });

    it('does not tier public routes, service calls or principals without a tenant', async () => {
        expect(await run({ tenant: { status: TenantStatus.SUSPENDED }, metadata: { [IS_PUBLIC_KEY]: true } })).toBe(true);
        expect(await run({ tenant: { status: TenantStatus.SUSPENDED }, user: { ...member, isServiceToken: true } })).toBe(true);
        expect(await run({ tenant: { status: TenantStatus.SUSPENDED }, user: { ...member, tenantId: '' } })).toBe(true);
    });

    it('refuses a deleted tenant as not found', async () => {
        expectRefused(await run({ tenant: { deletedAt: new Date() } }), HttpStatus.NOT_FOUND, 'tenant_not_found');
        expectRefused(await run({ tenant: null }), HttpStatus.NOT_FOUND, 'tenant_not_found');
    });

    it('refuses everything for a suspended tenant', async () => {
        expectRefused(
            await run({ tenant: { status: TenantStatus.SUSPENDED }, metadata: { [ALLOW_LOCKED_TENANT_KEY]: true } }),
            HttpStatus.FORBIDDEN,
            'tenant_suspended'
        );
    });

    describe('given a self-locked tenant', () => {
        it('then ordinary routes are refused', async () => {
            expectRefused(await run({ tenant: { status: TenantStatus.LOCKED } }), HttpStatus.FORBIDDEN, 'tenant_locked');
        });

        it('then the unlock route (@AllowLockedTenant) is reachable', async () => {
            expect(await run({ tenant: { status: TenantStatus.LOCKED }, method: 'PUT', metadata: { [ALLOW_LOCKED_TENANT_KEY]: true } })).toBe(true);
        });
    });

    describe('given a tenant locked for non-payment', () => {
        it('then every method is refused with 402', async () => {
            expectRefused(await run({ tenant: { paymentStatus: PaymentStatusEnum.LOCKED } }), HttpStatus.PAYMENT_REQUIRED, 'payment_required');
        });

        it('then billing routes (@AllowUnpaidTenant) stay open so the tenant can pay', async () => {
            expect(
                await run({ tenant: { paymentStatus: PaymentStatusEnum.LOCKED }, method: 'POST', metadata: { [ALLOW_UNPAID_TENANT_KEY]: true } })
            ).toBe(true);
        });
    });

    describe('given a tenant restricted for non-payment', () => {
        it.each(['GET', 'HEAD', 'OPTIONS'])('then %s is allowed (read-only tier)', async (method) => {
            expect(await run({ tenant: { paymentStatus: PaymentStatusEnum.RESTRICTED }, method })).toBe(true);
        });

        it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('then %s is refused with 402', async (method) => {
            expectRefused(
                await run({ tenant: { paymentStatus: PaymentStatusEnum.RESTRICTED }, method }),
                HttpStatus.PAYMENT_REQUIRED,
                'payment_required'
            );
        });
    });

    it('lets a past-due tenant work normally — the dashboard warns, access is unchanged', async () => {
        expect(await run({ tenant: { paymentStatus: PaymentStatusEnum.PAST_DUE }, method: 'POST' })).toBe(true);
    });
});
