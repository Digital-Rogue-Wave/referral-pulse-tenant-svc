import { Injectable } from '@nestjs/common';

import { KybProvider, KybSession, kybExternalUserId } from './kyb-provider';

/**
 * Stands in for Sumsub in tests and on a local stack without sandbox keys (`KYB_PROVIDER=fake`, E1 D15). It opens no
 * real session; a result is simulated by posting a signed Sumsub-shaped webhook to Event Ingestion.
 */
@Injectable()
export class FakeKybProvider implements KybProvider {
    readonly name = 'fake';

    openSession(tenantId: string, verificationId: string): Promise<KybSession> {
        const externalUserId = kybExternalUserId(tenantId, verificationId);
        return Promise.resolve({ provider: this.name, externalUserId, url: `https://kyb.invalid/session/${encodeURIComponent(externalUserId)}` });
    }
}
