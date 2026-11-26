import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@common/http/http-client.service';
import type { AllConfigType } from '@config/config.type';
import { ConnectionProvider, OutboundCredentials } from '@domains/connection';

/** One authenticated read per provider: enough to prove the credential works, nothing that changes the account. */
interface Probe {
    method: 'GET' | 'POST';
    path: string;
    origin: (config: Record<string, unknown>) => string | null;
    authorization: (apiKey: string, config: Record<string, unknown>) => string | null;
    body?: string;
}

const live = (config: Record<string, unknown>): boolean => config.environment === 'live';
const bearer = (apiKey: string): string => `Bearer ${apiKey}`;

const PROBES: Partial<Record<ConnectionProvider, Probe>> = {
    [ConnectionProvider.PAYPAL]: {
        method: 'POST',
        path: '/v1/oauth2/token',
        origin: (c) => (live(c) ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'),
        authorization: (apiKey, c) => (typeof c.clientId === 'string' ? `Basic ${Buffer.from(`${c.clientId}:${apiKey}`).toString('base64')}` : null),
        body: 'grant_type=client_credentials'
    },
    [ConnectionProvider.WISE]: {
        method: 'GET',
        path: '/v1/profiles',
        origin: (c) => (live(c) ? 'https://api.wise.com' : 'https://api.sandbox.transferwise.tech'),
        authorization: bearer
    },
    [ConnectionProvider.TREMENDOUS]: {
        method: 'GET',
        path: '/api/v2/funding_sources',
        origin: (c) => (live(c) ? 'https://api.tremendous.com' : 'https://testflight.tremendous.com'),
        authorization: bearer
    },
    [ConnectionProvider.HUBSPOT]: { method: 'GET', path: '/account-info/v3/details', origin: () => 'https://api.hubapi.com', authorization: bearer },
    [ConnectionProvider.SALESFORCE]: {
        method: 'GET',
        path: '/services/oauth2/userinfo',
        origin: (c) => (typeof c.instanceUrl === 'string' ? c.instanceUrl.replace(/\/+$/, '') : null),
        authorization: bearer
    }
};

const PROBE_TIMEOUT_MS = 5000;

/**
 * `POST /v1/connections/{id}/test` (v5.2 API §3.16): an outbound connectivity check with the connection's own
 * credential. Answers null when the provider accepted it, otherwise why not — a status or a missing setting, never
 * the credential. Decryption stays in tenant-service (US1.5.4 AC3), so the check runs here.
 */
@Injectable()
export class ConnectionTester {
    private readonly baseUrlOverride: string | null;

    constructor(
        private readonly http: HttpClientService,
        configService: ConfigService<AllConfigType>
    ) {
        this.baseUrlOverride = configService.get('connectionConfig.connectionTestBaseUrl', { infer: true }) ?? null;
    }

    async check(provider: ConnectionProvider, credentials: OutboundCredentials, config: Record<string, unknown>): Promise<string | null> {
        const probe = PROBES[provider];
        if (!probe) {
            return `no outbound check exists for ${provider}`;
        }
        if (!credentials.apiKey) {
            // TODO(P5): exchange the oauth_code for tokens with each provider's connector; until then only an api_key can be checked.
            return credentials.oauthCode ? 'oauth_code_not_exchanged' : 'no outbound credential stored';
        }
        const origin = this.baseUrlOverride ?? probe.origin(config);
        const authorization = probe.authorization(credentials.apiKey, config);
        if (!origin || !authorization) {
            return provider === ConnectionProvider.PAYPAL ? 'config.client_id is missing' : 'config.instance_url is missing';
        }
        return this.call(probe, `${origin.replace(/\/+$/, '')}${probe.path}`, authorization);
    }

    private async call(probe: Probe, url: string, authorization: string): Promise<string | null> {
        const options = {
            headers: { Authorization: authorization, ...(probe.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
            timeout: PROBE_TIMEOUT_MS,
            retries: 0,
            skipCircuitBreaker: true
        };
        try {
            await (probe.method === 'POST' ? this.http.post(url, probe.body, options) : this.http.get(url, options));
            return null;
        } catch (error) {
            const status = (error as { response?: { status?: number } }).response?.status;
            return status ? `provider answered HTTP ${status}` : 'provider unreachable';
        }
    }
}
