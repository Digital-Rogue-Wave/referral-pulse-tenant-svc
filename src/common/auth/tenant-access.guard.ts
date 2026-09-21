import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata, CustomDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Request } from 'express';

import type { IAuthenticatedUser } from '@app/types';
import { IS_PUBLIC_KEY } from '@app/types';

import { PaymentStatusEnum } from '@common/enums/billing.enum';
import { BaseException } from '@common/exceptions/base.exceptions';
import { DatabaseService } from '@app/database/database.service';
import { TenantStatus } from '@domains/tenant/tenant.types';

import { ALLOW_LOCKED_TENANT_KEY } from './require-permission.decorator';

export const ALLOW_UNPAID_TENANT_KEY = 'authz:allow_unpaid_tenant';

/** Billing routes: a tenant locked or restricted for non-payment must still be able to pay. */
export const AllowUnpaidTenant = (): CustomDecorator<string> => SetMetadata(ALLOW_UNPAID_TENANT_KEY, true);

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global tenant access tiers, evaluated once per request from a single tenant read:
 *
 * | state                         | effect                                                          |
 * |-------------------------------|-----------------------------------------------------------------|
 * | status `suspended`            | 403 everywhere — a platform action; the tenant contacts support |
 * | status `locked` (self-lock)   | 403 except `@AllowLockedTenant` (unlocking itself)              |
 * | payment `locked`              | 402 except `@AllowUnpaidTenant` (billing, so they can pay)      |
 * | payment `restricted`          | read-only: mutations 402 except `@AllowUnpaidTenant`            |
 *
 * The tenant comes from the verified principal. The previous per-controller guards read it from the
 * request context, which is not populated until after guards run, so the payment tiers never applied.
 * Routes without a tenant (public, service calls, pre-membership onboarding) are not tiered here.
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: DatabaseService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const targets = [context.getHandler(), context.getClass()];
        if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
            return true;
        }
        const request = context.switchToHttp().getRequest<Request>();
        const user = request.user as IAuthenticatedUser | undefined;
        if (!user?.tenantId || user.isServiceToken) {
            return true;
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: user.tenantId },
            select: { status: true, paymentStatus: true, deletedAt: true, lockedAt: true, lockUntil: true }
        });
        if (!tenant || tenant.deletedAt || tenant.status === TenantStatus.DELETED) {
            throw new BaseException('tenant_not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
        }
        if (tenant.status === TenantStatus.SUSPENDED) {
            throw new BaseException('tenant_suspended', 'This account has been suspended. Please contact support.', HttpStatus.FORBIDDEN);
        }
        if (tenant.status === TenantStatus.LOCKED && !this.reflector.getAllAndOverride<boolean>(ALLOW_LOCKED_TENANT_KEY, targets)) {
            throw new BaseException('tenant_locked', 'This account is locked. Unlock it with your password.', HttpStatus.FORBIDDEN, undefined, {
                lockedAt: tenant.lockedAt,
                lockUntil: tenant.lockUntil
            });
        }

        if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNPAID_TENANT_KEY, targets)) {
            return true;
        }
        if (tenant.paymentStatus === PaymentStatusEnum.LOCKED) {
            throw new BaseException('payment_required', 'Payment is required to access this resource.', HttpStatus.PAYMENT_REQUIRED);
        }
        if (tenant.paymentStatus === PaymentStatusEnum.RESTRICTED && !READ_ONLY_METHODS.has(request.method.toUpperCase())) {
            throw new BaseException(
                'payment_required',
                'Your account is restricted for non-payment and is currently read-only. Settle the outstanding invoice to restore write access.',
                HttpStatus.PAYMENT_REQUIRED
            );
        }
        return true;
    }
}
