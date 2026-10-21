import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { ComplianceEvents, ConsentProps, ConsentRecordedEvent, ConsentStatus } from '@domains/compliance';

/** One consent signal, as it arrives off a touch event (Event Model §2.4). */
export interface ConsentSignal {
    tenantId: string;
    subjectEmailHash: string | null;
    subjectExternalId: string | null;
    trackingConsent: string;
    marketingConsent: string | null;
    consentSource: string | null;
    recordedAt: Date;
}

export type ConsentOutcome = 'recorded' | 'unchanged' | 'ignored';

const STATUSES = Object.values(ConsentStatus) as string[];

/**
 * The consent registry (Product Spec R-CPL-01: "the Tenant service hosts the consent registry").
 *
 * Append-only: a change of mind is a new row, never an edit, because the proof of what was consented
 * to and when is the whole point (DB Model §0.4, "Correction = a new compensating row"). A subject's
 * current state is their latest row, so an unchanged signal — which is almost every touch — is
 * dropped rather than stored, and the table grows with decisions rather than with traffic.
 */
@Injectable()
export class ConsentService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(ConsentService.name);
    }

    async record(signal: ConsentSignal): Promise<ConsentOutcome> {
        if (!STATUSES.includes(signal.trackingConsent) || (!signal.subjectEmailHash && !signal.subjectExternalId)) {
            return 'ignored';
        }
        const latest = await this.latestFor(signal);
        if (latest && !hasChanged(latest, signal)) {
            return 'unchanged';
        }

        await this.prisma.$transaction(async (tx) => {
            const row = (await tx.consent.create({
                data: {
                    tenantId: signal.tenantId,
                    subjectEmailHash: signal.subjectEmailHash,
                    subjectExternalId: signal.subjectExternalId,
                    trackingConsent: signal.trackingConsent,
                    marketingConsent: signal.marketingConsent,
                    consentSource: signal.consentSource,
                    recordedAt: signal.recordedAt,
                    // The row that records a denial following a grant *is* the withdrawal, so it is
                    // the row that carries its timestamp — an earlier row is never edited.
                    withdrawnAt: isWithdrawal(latest, signal) ? signal.recordedAt : null
                }
            })) as ConsentProps;
            this.txEventEmitter.emitAfterCommit(
                ComplianceEvents.CONSENT_RECORDED,
                new ConsentRecordedEvent(row.id, signal.tenantId, {
                    subjectEmailHash: row.subjectEmailHash,
                    subjectExternalId: row.subjectExternalId,
                    trackingConsent: row.trackingConsent,
                    marketingConsent: row.marketingConsent,
                    consentSource: row.consentSource,
                    recordedAt: row.recordedAt
                })
            );
        });
        this.logger.debug('Consent recorded', { tenantId: signal.tenantId, trackingConsent: signal.trackingConsent });
        return 'recorded';
    }

    /**
     * The subject's current state. Matched on the email hash when there is one, because that is the
     * identifier the other services and a DSR all use; the client's own id is the fallback for a
     * subject identified only by `invitee_external_id`.
     */
    private async latestFor(signal: ConsentSignal): Promise<ConsentProps | null> {
        const subject = signal.subjectEmailHash ? { subjectEmailHash: signal.subjectEmailHash } : { subjectExternalId: signal.subjectExternalId };
        return (await this.prisma.consent.findFirst({
            where: { tenantId: signal.tenantId, ...subject },
            orderBy: { recordedAt: 'desc' }
        })) as ConsentProps | null;
    }
}

function hasChanged(latest: ConsentProps, signal: ConsentSignal): boolean {
    return (
        latest.trackingConsent !== signal.trackingConsent ||
        latest.marketingConsent !== signal.marketingConsent ||
        latest.consentSource !== signal.consentSource
    );
}

function isWithdrawal(latest: ConsentProps | null, signal: ConsentSignal): boolean {
    return latest?.trackingConsent === ConsentStatus.GRANTED && signal.trackingConsent === ConsentStatus.DENIED;
}
