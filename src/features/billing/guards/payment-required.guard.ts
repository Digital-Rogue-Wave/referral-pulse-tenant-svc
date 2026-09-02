import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';

import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { DatabaseService } from '@app/database/database.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { PaymentStatusEnum } from '@common/enums/billing.enum';

/** HTTP methods that only read state — permitted while a tenant is RESTRICTED. */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Enforces the account state machine's access tiers.
 *
 * | paymentStatus | Effect                                        |
 * |---------------|-----------------------------------------------|
 * | active        | full access                                   |
 * | past_due      | full access (dashboard shows a warning)       |
 * | restricted    | **read-only** — mutations rejected with 402   |
 * | locked        | no access — every method rejected with 402    |
 *
 * `restricted` previously had no effect at all: the guard tested only for
 * LOCKED, so the entire 7–21 day read-only tier was unenforced.
 *
 * Reads the tenant through the globally-provided DatabaseService rather than
 * TenantService, so the guard carries no module dependency and can be applied
 * from any feature module without creating an import cycle with BillingModule.
 */
@Injectable()
export class PaymentRequiredGuard implements CanActivate {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            return true;
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId, deletedAt: null },
            select: { paymentStatus: true }
        });

        if (!tenant) {
            throw new BaseException('tenant_not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
        }

        if (tenant.paymentStatus === PaymentStatusEnum.LOCKED) {
            throw new BaseException('payment_required', 'Payment is required to access this resource.', HttpStatus.PAYMENT_REQUIRED);
        }

        if (tenant.paymentStatus === PaymentStatusEnum.RESTRICTED && !this.isReadOnly(context)) {
            throw new BaseException(
                'payment_required',
                'Your account is restricted for non-payment and is currently read-only. Settle the outstanding invoice to restore write access.',
                HttpStatus.PAYMENT_REQUIRED
            );
        }

        return true;
    }

    private isReadOnly(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request | undefined>();
        const method = request?.method?.toUpperCase();

        // Non-HTTP contexts (queue processors, scheduled jobs) carry no method;
        // they are internal and must not be blocked by a read-only tier.
        if (!method) {
            return true;
        }

        return READ_ONLY_METHODS.has(method);
    }
}
