import { HttpStatus } from '@nestjs/common';

import { BaseException } from '@common/exceptions/base.exceptions';
import { ConnectionCredentialsDto, ConnectionProvider, DIRECTION_OF, OutboundCredentials, receivesCallbacks } from '@domains/connection';

/** What one request's credentials become before they are sealed: the inbound secret and the outbound credential. */
export interface AcceptedCredentials {
    signingSecret?: string;
    outbound?: OutboundCredentials;
}

/** Wise signs its callbacks with Wise's own key (platform config), so a Wise connection holds no inbound secret. */
const NO_INBOUND_SECRET = new Set<ConnectionProvider>([ConnectionProvider.WISE]);

/**
 * Which credentials each provider takes (v5.2 API §3.16): Chargebee basic auth, a webhook signing secret, an outbound
 * `api_key` / `oauth_code`, or — for Zapier — none. On create, everything the provider's direction needs is required;
 * on rotate, any subset the provider takes, at least one field.
 */
export function acceptCredentials(
    provider: ConnectionProvider,
    dto: ConnectionCredentialsDto | undefined,
    mode: 'create' | 'rotate'
): AcceptedCredentials {
    const given = dto ?? {};
    if (provider === ConnectionProvider.ZAPIER) {
        refuseAny(given, 'A Zapier connection stores no credentials: Zapier subscribes through POST /v1/webhooks');
        return {};
    }
    const accepted: AcceptedCredentials = { signingSecret: inboundSecretOf(provider, given), outbound: outboundOf(provider, given) };
    if (mode === 'rotate' && !accepted.signingSecret && !accepted.outbound) {
        throw invalid('credentials', 'Send at least one credential to rotate');
    }
    if (mode === 'create') {
        requireWhatTheDirectionNeeds(provider, accepted);
    }
    return accepted;
}

function inboundSecretOf(provider: ConnectionProvider, given: ConnectionCredentialsDto): string | undefined {
    const basic = given.basicAuthUser !== undefined || given.basicAuthPassword !== undefined;
    if (provider === ConnectionProvider.CHARGEBEE) {
        refuse(given.signingSecret, 'credentials.signing_secret', 'Chargebee authenticates with basic_auth_user and basic_auth_password');
        if (basic && (!given.basicAuthUser || !given.basicAuthPassword)) {
            throw invalid('credentials.basic_auth_password', 'Chargebee needs both basic_auth_user and basic_auth_password');
        }
        return basic ? `${given.basicAuthUser}:${given.basicAuthPassword}` : undefined;
    }
    if (basic) {
        throw invalid('credentials.basic_auth_user', `A ${provider} connection takes no basic-auth credentials`);
    }
    if (NO_INBOUND_SECRET.has(provider) || !receivesCallbacks(DIRECTION_OF[provider])) {
        refuse(given.signingSecret, 'credentials.signing_secret', `A ${provider} connection takes no signing secret`);
    }
    return given.signingSecret;
}

function outboundOf(provider: ConnectionProvider, given: ConnectionCredentialsDto): OutboundCredentials | undefined {
    if (given.apiKey === undefined && given.oauthCode === undefined) {
        return undefined;
    }
    if (!callsOut(provider)) {
        throw invalid(given.apiKey !== undefined ? 'credentials.api_key' : 'credentials.oauth_code', `A ${provider} connection is inbound only`);
    }
    return { ...(given.apiKey ? { apiKey: given.apiKey } : {}), ...(given.oauthCode ? { oauthCode: given.oauthCode } : {}) };
}

function requireWhatTheDirectionNeeds(provider: ConnectionProvider, accepted: AcceptedCredentials): void {
    if (receivesCallbacks(DIRECTION_OF[provider]) && !NO_INBOUND_SECRET.has(provider) && !accepted.signingSecret) {
        const field = provider === ConnectionProvider.CHARGEBEE ? 'credentials.basic_auth_user' : 'credentials.signing_secret';
        throw invalid(field, `A ${provider} connection needs the secret its callbacks are verified with`);
    }
    if (callsOut(provider) && !accepted.outbound) {
        throw invalid('credentials.api_key', `A ${provider} connection needs an api_key or an oauth_code for its outbound calls`);
    }
}

const callsOut = (provider: ConnectionProvider): boolean => DIRECTION_OF[provider] !== 'inbound' && provider !== ConnectionProvider.ZAPIER;

function refuseAny(given: ConnectionCredentialsDto, message: string): void {
    if (Object.values(given).some((value) => value !== undefined)) {
        throw invalid('credentials', message);
    }
}

function refuse(value: string | undefined, field: string, message: string): void {
    if (value !== undefined) {
        throw invalid(field, message);
    }
}

const invalid = (field: string, message: string): BaseException => new BaseException('invalid_request', message, HttpStatus.BAD_REQUEST, field);
