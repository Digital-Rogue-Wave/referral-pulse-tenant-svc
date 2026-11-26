import { ConnectionProvider } from '@domains/connection';

import { ConnectionTester } from './connection-tester';

const tester = (http: { get?: jest.Mock; post?: jest.Mock }, override?: string): ConnectionTester =>
    new ConnectionTester(http as never, { get: () => override } as never);

describe('The outbound connection check', () => {
    it('asks Wise sandbox for the profiles with the api key as a bearer token', async () => {
        const get = jest.fn().mockResolvedValue({ status: 200 });

        await expect(tester({ get }).check(ConnectionProvider.WISE, { apiKey: 'wise-key' }, {})).resolves.toBeNull();
        expect(get).toHaveBeenCalledWith(
            'https://api.sandbox.transferwise.tech/v1/profiles',
            expect.objectContaining({ headers: { Authorization: 'Bearer wise-key' }, retries: 0 })
        );
    });

    it('asks PayPal live for a token with client id and secret', async () => {
        const post = jest.fn().mockResolvedValue({ status: 200 });

        await tester({ post }).check(ConnectionProvider.PAYPAL, { apiKey: 'sec' }, { clientId: 'cid', environment: 'live' });

        expect(post.mock.calls[0][0]).toBe('https://api-m.paypal.com/v1/oauth2/token');
        expect(post.mock.calls[0][2].headers.Authorization).toBe(`Basic ${Buffer.from('cid:sec').toString('base64')}`);
    });

    it('reports the provider status on a refusal, never the credential', async () => {
        const get = jest.fn().mockRejectedValue({ response: { status: 401 } });

        await expect(tester({ get }).check(ConnectionProvider.HUBSPOT, { apiKey: 'pat-secret' }, {})).resolves.toBe('provider answered HTTP 401');
    });

    it('sends every probe to the configured stub origin in local runs', async () => {
        const get = jest.fn().mockResolvedValue({ status: 200 });

        await tester({ get }, 'http://localhost:5099/').check(ConnectionProvider.TREMENDOUS, { apiKey: 'k' }, {});

        expect(get.mock.calls[0][0]).toBe('http://localhost:5099/api/v2/funding_sources');
    });

    it.each([
        [ConnectionProvider.PAYPAL, { apiKey: 'sec' }, {}, 'config.client_id is missing'],
        [ConnectionProvider.SALESFORCE, { apiKey: 'tok' }, {}, 'config.instance_url is missing'],
        [ConnectionProvider.HUBSPOT, { oauthCode: 'code' }, {}, 'oauth_code_not_exchanged'],
        [ConnectionProvider.ZAPIER, {}, {}, 'no outbound check exists for zapier']
    ])('explains a %s check it cannot run', async (provider, credentials, config, failure) => {
        await expect(tester({}).check(provider, credentials, config)).resolves.toBe(failure);
    });
});
