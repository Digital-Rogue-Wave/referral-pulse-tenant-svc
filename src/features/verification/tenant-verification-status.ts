import { Injectable } from '@nestjs/common';

import type { Prisma } from '@prisma-gen/generated/client';

import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { TenantEvents, TenantVerifiedEvent } from '@domains/tenant/events/tenant.events';
import { VerificationStatus } from '@domains/tenant/tenant.types';

/** The one place `tenants.verification_status` changes, so `tenant.verified` is emitted on every change (US1.6.1 AC2). */
@Injectable()
export class TenantVerificationStatus {
    constructor(private readonly txEventEmitter: TransactionEventEmitterService) {}

    /** Inside the caller's transaction: sets the status and announces it; the same status again changes nothing. */
    async change(tx: Prisma.TransactionClient, tenantId: string, to: VerificationStatus, decidedBy: string, reason: string | null): Promise<void> {
        const { verificationStatus: from } = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { verificationStatus: true } });
        if (from === to) {
            return;
        }
        await tx.tenant.update({ where: { id: tenantId }, data: { verificationStatus: to } });
        this.txEventEmitter.emitAfterCommit(
            TenantEvents.VERIFIED,
            new TenantVerifiedEvent(tenantId, tenantId, from, to, decidedBy, new Date(), reason)
        );
    }
}
