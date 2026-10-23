import { Injectable } from '@nestjs/common';

import type { Message } from '@aws-sdk/client-sqs';
import { SqsConsumerEventHandler, SqsMessageHandler } from '@ssut/nestjs-sqs';

import { TENANT_SVC_FIFO } from '@app/types';
import { hashEmail } from '@common/helper/hashing';
import { JsonService } from '@common/helper/json.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { ConsentService, type ConsentSignal } from './consent.service';

/**
 * The parts of an Event Ingestion event this service reads. Both spellings are accepted because
 * ingestion publishes the canonical Event Model envelope *and* the flat keys it has always emitted
 * (Event Model §2.6 forbids removing a field), and nothing says which one a given producer sends.
 */
interface IngestionEvent {
    event_type?: string;
    occurred_at?: string;
    tenant?: { tenant_id?: string };
    tenantId?: string;
    consent?: { tracking_consent?: string; marketing_consent?: string; consent_source?: string; consent_recorded_at?: string };
    consent_status?: string;
    invitee_email?: string;
    invitee_external_id?: string;
}

/**
 * Keeps the consent registry current from the bus.
 *
 * API Contract §3.15 is explicit that "Consent is a field on touch events (captured from CMP by JS
 * SDK), not a standalone resource" — there is no endpoint to write consent to. R-CPL-01 nevertheless
 * makes this service the registry's owner, so the only way to hold it is to read the touch events,
 * which is why this service now consumes a queue at all (NOTE.md §V5.16).
 *
 * The invitee's address arrives in the clear and is hashed before anything else happens to it: the
 * registry stores `subject_email_hash` and nothing here logs the address.
 */
@Injectable()
export class ConsentConsumer {
    constructor(
        private readonly consent: ConsentService,
        private readonly json: JsonService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(ConsentConsumer.name);
    }

    @SqsMessageHandler(TENANT_SVC_FIFO, false)
    async handle(message: Message): Promise<void> {
        const signal = this.toSignal(message);
        if (!signal) {
            return;
        }
        const outcome = await this.consent.record(signal);
        if (outcome === 'ignored') {
            this.logger.debug('A consent signal named no subject, or no recognised status', { tenantId: signal.tenantId });
        }
    }

    /**
     * A message that is not an event, or an event with no consent block, is not an error: this queue
     * carries whatever the bus fans out to this service, and consent is one field on some of it.
     */
    private toSignal(message: Message): ConsentSignal | null {
        const event = message.Body ? this.json.safeParse<IngestionEvent>(message.Body) : undefined;
        const tenantId = event?.tenant?.tenant_id ?? event?.tenantId;
        const trackingConsent = event?.consent?.tracking_consent ?? event?.consent_status;
        if (!event || !tenantId || !trackingConsent) {
            return null;
        }
        return {
            tenantId,
            subjectEmailHash: event.invitee_email ? hashEmail(event.invitee_email) : null,
            subjectExternalId: event.invitee_external_id ?? null,
            trackingConsent,
            marketingConsent: event.consent?.marketing_consent ?? null,
            consentSource: event.consent?.consent_source ?? null,
            // §2.4's `consent_recorded_at` is "when the signal was captured", which is the timestamp
            // the registry wants; ingestion does not populate it today, so the event's own time stands in.
            recordedAt: toDate(event.consent?.consent_recorded_at ?? event.occurred_at)
        };
    }

    @SqsConsumerEventHandler(TENANT_SVC_FIFO, 'error')
    onError(error: Error): void {
        this.logger.error(`SQS consumer error on ${TENANT_SVC_FIFO}: ${error.message}`, error.stack);
    }

    @SqsConsumerEventHandler(TENANT_SVC_FIFO, 'processing_error')
    onProcessingError(error: Error): void {
        this.logger.error(`Could not process a message from ${TENANT_SVC_FIFO}: ${error.message}`, error.stack);
    }
}

function toDate(value: string | undefined): Date {
    const parsed = value ? new Date(value) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
