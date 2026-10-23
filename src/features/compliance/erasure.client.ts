import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AxiosError } from 'axios';

import { HttpClientService } from '@common/http/http-client.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { ServiceTokenProvider } from '@common/clients/service-token.provider';
import { DsrReceiptStatus } from '@domains/compliance';

import type { AllConfigType } from '@config/config.type';

import { ErasureTarget, REMOTE_ERASURE_PATH } from './dsr-targets';

/**
 * The subject, as this service knows them, before it is narrowed to what a target accepts.
 *
 * `externalId` is carried here and deliberately not sent: no implemented handler has a field for it
 * (see `ErasureClient.toWire`).
 */
export interface ErasureSubject {
    dsrId: string;
    tenantId: string;
    emailHash: string | null;
    participantId: string | null;
    externalId: string | null;
}

/**
 * What a target's erasure handler accepts, in its wire spelling.
 *
 * snake_case because every service in the fleet runs the global wire transform: analytics-service's
 * `ServiceScopeGuard` reads `tenant_id` off the raw body precisely because "the wire is snake_case and
 * `WireCaseInterceptor` has not camel-cased anything yet". Sending camelCase would reach the DTO as
 * unknown properties and `forbidNonWhitelisted` would answer 400.
 */
interface SubjectErasureWire {
    dsr_id: string;
    tenant_id: string;
    participant_id?: string;
    subject_email_hash?: string;
}

/** A target's answer, as this service records it. */
export interface TargetReceipt {
    status: DsrReceiptStatus;
    receipt: Record<string, unknown>;
    retainedUnderObligation: boolean;
}

/** The receipt body a target returns. `retained` and `status` spell the same in both cases. */
interface RemoteReceiptBody {
    status?: string;
    /**
     * What the target kept, and on what basis. A list in notification-service's and this service's
     * receipts, a single sentence in analytics-service's — read both ways rather than reading the
     * sentence as "nothing retained", which is the opposite of what it says. The shape is worth
     * settling in the contract (NOTE.md §V5.19).
     */
    retained?: unknown;
    [key: string]: unknown;
}

/** The target answered, but with something an operator has to look at. */
const BLOCKED = 'blocked';

@Injectable()
export class ErasureClient {
    constructor(
        private readonly http: HttpClientService,
        private readonly tokens: ServiceTokenProvider,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(ErasureClient.name);
    }

    /**
     * Asks one target to erase its share. Never throws: a target that cannot answer yet becomes a
     * `pending` receipt carrying why, so the fan-out can be retried and resume at exactly the targets
     * that still owe an answer.
     */
    async erase(target: ErasureTarget, subject: ErasureSubject): Promise<TargetReceipt> {
        const wire = this.toWire(subject);
        if (!wire) {
            return this.unidentifiable(target, subject);
        }
        const url = `${this.baseUrlOf(target)}${REMOTE_ERASURE_PATH}`;
        try {
            const response = await this.http.post<RemoteReceiptBody>(url, wire, {
                headers: { Authorization: await this.tokens.authorization() },
                // One attempt per fan-out run. A target that is down is a pending receipt the next run
                // picks up, which is a longer and cheaper retry than hammering it inside one job.
                retries: 0
            });
            return this.fromBody(target, response.data);
        } catch (error) {
            return this.unanswered(target, error);
        }
    }

    /**
     * Narrows the subject to the fields the handler contract has, which is the one analytics-service
     * and notification-service both already implement: `dsr_id` and `tenant_id` required, then at
     * least one of `participant_id`, `user_id` or `subject_email_hash`.
     *
     * `user_id` is never sent: it names an *operator*, which is Identity's own share and runs
     * in-process. A subject carrying neither a participant id nor an email hash cannot be addressed
     * at all — no handler has a field for the client's own `subject_external_id` — so the call is not
     * made rather than sent to be refused. Spec defect 15 in NOTE.md.
     */
    private toWire(subject: ErasureSubject): SubjectErasureWire | null {
        if (!subject.emailHash && !subject.participantId) {
            return null;
        }
        return {
            dsr_id: subject.dsrId,
            tenant_id: subject.tenantId,
            ...(subject.participantId ? { participant_id: subject.participantId } : {}),
            ...(subject.emailHash ? { subject_email_hash: subject.emailHash } : {})
        };
    }

    private baseUrlOf(target: ErasureTarget): string {
        if (!target.configKey) {
            throw new Error(`${target.serviceName} has no base URL: its share runs in-process`);
        }
        return this.configService.getOrThrow('services', { infer: true })[target.configKey].url;
    }

    private fromBody(target: ErasureTarget, body: RemoteReceiptBody): TargetReceipt {
        // `blocked` is this service's own vocabulary for "there is a reason I did not erase" — a target
        // reporting it has answered, but not finished, so it needs a human rather than a retry.
        const status = body.status === BLOCKED ? DsrReceiptStatus.FAILED : DsrReceiptStatus.COMPLETED;
        return { status, receipt: { ...body, share: target.share }, retainedUnderObligation: hasRetained(body.retained) };
    }

    /** Pending, not failed: it resolves the day the handler contract gains an external-id field. */
    private unidentifiable(target: ErasureTarget, subject: ErasureSubject): TargetReceipt {
        this.logger.warn('An erasure subject carries no identifier the handler contract accepts', {
            service: target.serviceName,
            dsrId: subject.dsrId,
            hasExternalId: Boolean(subject.externalId)
        });
        return {
            status: DsrReceiptStatus.PENDING,
            receipt: {
                service: target.serviceName,
                share: target.share,
                unanswered: 'subject carries no participant id and no email hash; the handler contract accepts no external id'
            },
            retainedUnderObligation: false
        };
    }

    private unanswered(target: ErasureTarget, error: unknown): TargetReceipt {
        const httpStatus = error instanceof AxiosError ? error.response?.status : undefined;
        const reason = httpStatus ? `HTTP ${httpStatus}` : errorMessage(error);
        // A 4xx that is not 404 means the target answered and refused — the request or this service's
        // grant is wrong, and retrying will not change it.
        const refused = httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 404;
        this.logger.warn('An erasure target did not return a receipt', { service: target.serviceName, reason, refused });
        return {
            status: refused ? DsrReceiptStatus.FAILED : DsrReceiptStatus.PENDING,
            receipt: { service: target.serviceName, share: target.share, unanswered: reason },
            retainedUnderObligation: false
        };
    }
}

/**
 * A connection refusal arrives with an empty `message` and the reason only in `code`, which wrote
 * `"unanswered": ""` into the receipt — the one field whose whole job is to say why.
 */
function errorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
        return error.code ?? error.message ?? 'unknown error';
    }
    return error instanceof Error && error.message ? error.message : 'unknown error';
}

/** True when the target said it kept something, whichever of the two shapes it said it in. */
function hasRetained(retained: unknown): boolean {
    if (Array.isArray(retained)) {
        return retained.length > 0;
    }
    return typeof retained === 'string' && retained.trim().length > 0;
}
