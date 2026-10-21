import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@common/http/http-client.service';

import type { AllConfigType } from '@config/config.type';

/** Renew this long before expiry, so a token never expires between fetch and use. */
const RENEW_BEFORE_MS = 60_000;

interface TokenResponse {
    access_token: string;
    expires_in: number;
}

/**
 * This service's Ory Hydra client-credentials token for calls to another service's internal API
 * (API Contract §2: service-to-service calls carry a client-credentials token, and the callee grants a
 * capability to this client id in Keto).
 *
 * Needed since the DSR fan-out: tenant-service orchestrates erasure across the other services
 * (R-CPL-01), so it became an outbound caller for the first time. Cached in memory until shortly
 * before expiry; concurrent callers share one token request.
 */
@Injectable()
export class ServiceTokenProvider {
    private cached: { token: string; expiresAt: number } | null = null;
    private inFlight: Promise<string> | null = null;

    constructor(
        private readonly http: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>
    ) {}

    async authorization(): Promise<string> {
        return `Bearer ${await this.token()}`;
    }

    private async token(): Promise<string> {
        if (this.cached && this.cached.expiresAt - RENEW_BEFORE_MS > Date.now()) {
            return this.cached.token;
        }
        this.inFlight ??= this.fetch().finally(() => (this.inFlight = null));
        return this.inFlight;
    }

    private async fetch(): Promise<string> {
        const { tokenUrl, clientId, clientSecret, audience, scope } = this.configService.getOrThrow('services', { infer: true }).auth;
        // Checked here rather than at boot: this service had no outbound service calls before the DSR
        // fan-out, so a deployment without a registered client must still start — and must fail loudly
        // the first time it actually needs a token.
        if (!tokenUrl || !clientId || !clientSecret) {
            throw new Error('SERVICE_AUTH_TOKEN_URL, SERVICE_AUTH_CLIENT_ID and SERVICE_AUTH_CLIENT_SECRET must be set to call another service');
        }
        const credentials = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64');
        // `audience` is requested, not merely allowed: Hydra issues `"aud": []` when the token request
        // omits it, and every service rejects that token as "jwt audience invalid".
        // `scope` is for analytics-service, which authorizes its erasure handler on the token's scope
        // rather than on a Keto tuple like the rest of the fleet (NOTE.md §V5.17).
        const form = new URLSearchParams({
            grant_type: 'client_credentials',
            ...(audience ? { audience } : {}),
            ...(scope ? { scope } : {})
        });
        const response = await this.http.post<TokenResponse>(tokenUrl, form.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credentials}` }
        });
        this.cached = { token: response.data.access_token, expiresAt: Date.now() + response.data.expires_in * 1000 };
        return this.cached.token;
    }
}
