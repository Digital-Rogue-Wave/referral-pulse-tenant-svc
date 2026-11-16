import { createHmac } from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@common/http/http-client.service';

import type { AllConfigType } from '@config/config.type';

import { KybProvider, KybSession, kybExternalUserId } from './kyb-provider';

const WEBSDK_LINK_PATH = '/resources/sdkIntegrations/levels/-/websdkLink';

/**
 * Sumsub (E1 D15). One call opens a session: `POST /resources/sdkIntegrations/levels/-/websdkLink` with the level and our
 * applicant id returns the hosted WebSDK link; Sumsub creates the applicant when the link is first used.
 *
 * Every request is signed as Sumsub documents: `X-App-Token`, `X-App-Access-Ts` (seconds) and `X-App-Access-Sig` =
 * lowercase hex HMAC-SHA256 with the secret key over `ts + METHOD + path?query + body`.
 */
@Injectable()
export class SumsubKybProvider implements KybProvider {
    readonly name = 'sumsub';

    constructor(
        private readonly http: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>
    ) {}

    async openSession(tenantId: string, verificationId: string): Promise<KybSession> {
        const config = this.configService.getOrThrow('kyb', { infer: true });
        if (!config.sumsubAppToken || !config.sumsubSecretKey || !config.sumsubLevelName) {
            throw new Error('SUMSUB_APP_TOKEN, SUMSUB_SECRET_KEY and SUMSUB_LEVEL_NAME must be set to open a Sumsub session');
        }
        const externalUserId = kybExternalUserId(tenantId, verificationId);
        const body = JSON.stringify({ levelName: config.sumsubLevelName, userId: externalUserId, ttlInSecs: config.linkTtlSeconds });
        const response = await this.http.post<{ url: string }>(`${config.sumsubBaseUrl}${WEBSDK_LINK_PATH}`, body, {
            headers: {
                'Content-Type': 'application/json',
                ...signedHeaders(config.sumsubAppToken, config.sumsubSecretKey, 'POST', WEBSDK_LINK_PATH, body)
            }
        });
        return { provider: this.name, externalUserId, url: response.data.url };
    }
}

/** Sumsub's request signature (exported for its test). */
export function signedHeaders(appToken: string, secretKey: string, method: string, pathWithQuery: string, body: string): Record<string, string> {
    const ts = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', secretKey)
        .update(ts + method.toUpperCase() + pathWithQuery + body)
        .digest('hex');
    return { 'X-App-Token': appToken, 'X-App-Access-Ts': ts, 'X-App-Access-Sig': signature };
}
