import { Injectable } from '@nestjs/common';

import type { Message } from '@aws-sdk/client-sqs';

import { JsonService } from '@common/helper/json.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { CompanyVerificationService, ProviderVerificationResult } from './company-verification.service';

/** The normalised KYB result Event Ingestion publishes on `ingestion-events.fifo` (E1 D15). Every outcome opens the case for review. */
export const KYB_RESULT_EVENT = 'provider.verification_reviewed';
const OUTCOMES = new Set(['verified', 'rejected', 'in_review']);

interface KybResultEnvelope {
    eventType?: string;
    payload?: {
        tenant_id?: string;
        verification_id?: string;
        provider?: string;
        outcome?: string;
        reason?: string | null;
        retry_allowed?: boolean;
        provider_reference?: string | null;
        labels?: string[];
    };
}

/**
 * Applies the KYB provider's result (R-DOM-01: Ingestion translates the callback, the owning domain applies it). It reads
 * the same queue as the consent registry, `tenant-svc.fifo`; `handle()` answers whether the message was one of its own.
 */
@Injectable()
export class KybResultHandler {
    constructor(
        private readonly verifications: CompanyVerificationService,
        private readonly json: JsonService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(KybResultHandler.name);
    }

    async handle(message: Message): Promise<boolean> {
        const envelope = message.Body ? this.json.safeParse<KybResultEnvelope>(message.Body) : undefined;
        if (envelope?.eventType !== KYB_RESULT_EVENT) {
            return false;
        }
        const result = toResult(envelope.payload);
        if (!result) {
            this.logger.warn('A KYB result without its tenant, verification or outcome; ignored');
            return true;
        }
        await this.verifications.applyProviderResult(result);
        return true;
    }
}

function toResult(payload: KybResultEnvelope['payload']): ProviderVerificationResult | null {
    if (!payload?.tenant_id || !payload.verification_id || !payload.outcome || !OUTCOMES.has(payload.outcome)) {
        return null;
    }
    return {
        tenantId: payload.tenant_id,
        verificationId: payload.verification_id,
        provider: payload.provider ?? 'unknown',
        outcome: payload.outcome as ProviderVerificationResult['outcome'],
        reason: payload.reason ?? null,
        retryAllowed: payload.retry_allowed === true,
        providerReference: payload.provider_reference ?? null,
        labels: payload.labels ?? []
    };
}
