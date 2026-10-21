import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AxiosError } from 'axios';

import { HttpClientService } from '@common/http/http-client.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { ServiceTokenProvider } from '@common/clients/service-token.provider';
import { DsrReceiptStatus } from '@domains/compliance';

import type { AllConfigType } from '@config/config.type';

import { ErasureTarget, REMOTE_ERASURE_PATH } from './dsr-targets';

/** What this service asks of a target. The shape of its own `POST /internal/erasures/operators`. */
export interface SubjectErasureRequest {
    dsrId: string;
    subjectEmailHash?: string;
    subjectExternalId?: string;
    subjectId?: string;
}

/** A target's answer, as this service records it. */
export interface TargetReceipt {
    status: DsrReceiptStatus;
    receipt: Record<string, unknown>;
    retainedUnderObligation: boolean;
}

/** The receipt body a target returns, in the shape this service's own handler returns it. */
interface RemoteReceiptBody {
    status?: string;
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
    async erase(target: ErasureTarget, request: SubjectErasureRequest): Promise<TargetReceipt> {
        const url = `${this.baseUrlOf(target)}${REMOTE_ERASURE_PATH}`;
        try {
            const response = await this.http.post<RemoteReceiptBody>(url, request, {
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

    private baseUrlOf(target: ErasureTarget): string {
        if (!target.configKey) {
            throw new Error(`${target.serviceName} has no base URL: its share runs in-process`);
        }
        return this.configService.getOrThrow('services', { infer: true })[target.configKey].url;
    }

    private fromBody(target: ErasureTarget, body: RemoteReceiptBody): TargetReceipt {
        const retained = Array.isArray(body.retained) ? body.retained : [];
        // `blocked` is this service's own vocabulary for "there is a reason I did not erase" — a target
        // reporting it has answered, but not finished, so it needs a human rather than a retry.
        const status = body.status === BLOCKED ? DsrReceiptStatus.FAILED : DsrReceiptStatus.COMPLETED;
        return { status, receipt: { ...body, share: target.share }, retainedUnderObligation: retained.length > 0 };
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
}
