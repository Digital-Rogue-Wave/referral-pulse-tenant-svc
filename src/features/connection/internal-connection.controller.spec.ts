import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { PERMISSIONS_KEY, PLATFORM_ADMIN_KEY, SERVICE_CAPABILITIES_KEY } from '@common/auth/require-permission.decorator';
import { ConnectionProvider, ConnectionType } from '@domains/connection';

import { ConnectionService } from './connection.service';
import { InternalConnectionController } from './internal-connection.controller';

const CONNECTION_ID = '01HQZX000000000000000CON';

const resolved = {
    connectionId: CONNECTION_ID,
    tenantId: '01HQZX000000000000000TEN',
    provider: ConnectionProvider.STRIPE,
    connectionType: ConnectionType.BILLING,
    signingSecret: 'whsec_live_abcdefghijklmnop',
    config: {},
    enabled: true
};

/**
 * The one endpoint on this service that returns a decrypted provider secret. It exists because Event
 * Ingestion verifies provider callbacks against it (Architecture §2.4) and holds no database of its
 * own, so it reads the connection here and caches it.
 */
describe('Resolving a connection for the inbound receiver', () => {
    const findForReceiver = jest.fn();
    const controller = new InternalConnectionController({ findForReceiver } as unknown as ConnectionService);

    beforeEach(() => findForReceiver.mockReset());

    describe('given a live connection', () => {
        it('then the secret and the tenant it belongs to come back', async () => {
            findForReceiver.mockResolvedValue(resolved);

            await expect(controller.findForReceiver('stripe', CONNECTION_ID)).resolves.toEqual(resolved);
            expect(findForReceiver).toHaveBeenCalledWith('stripe', CONNECTION_ID);
        });
    });

    describe('given an unknown connection', () => {
        it('then it is a 404 — what the receiver owes the provider (API Contract §6.5)', async () => {
            findForReceiver.mockResolvedValue(null);

            await expect(controller.findForReceiver('stripe', CONNECTION_ID)).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('given a provider the platform does not integrate', () => {
        it('then it is the same 404, and nothing is looked up', async () => {
            await expect(controller.findForReceiver('monzo', CONNECTION_ID)).rejects.toBeInstanceOf(NotFoundException);
            expect(findForReceiver).not.toHaveBeenCalled();
        });
    });

    describe('given the route metadata', () => {
        const reflector = new Reflector();
        const metadata = (key: string): unknown => reflector.get(key, InternalConnectionController.prototype.findForReceiver);

        it('then only services granted provider_connection.read are admitted', () => {
            expect(metadata(SERVICE_CAPABILITIES_KEY)).toEqual([ServiceCapability.PROVIDER_CONNECTION_READ]);
        });

        it('then no dashboard permission opens it, because no human needs a decrypted secret', () => {
            expect(metadata(PERMISSIONS_KEY)).toBeUndefined();
            expect(metadata(PLATFORM_ADMIN_KEY)).toBeUndefined();
        });
    });
});
