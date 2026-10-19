import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { PERMISSIONS_KEY, PLATFORM_ADMIN_KEY, SERVICE_CAPABILITIES_KEY } from '@common/auth/require-permission.decorator';

import { InternalTrackingKeyController } from './internal-tracking-key.controller';

const KEY = 'b'.repeat(64);

const controllerWith = (key: string | undefined): InternalTrackingKeyController =>
    new InternalTrackingKeyController({ get: () => key } as unknown as ConfigService<never>);

/**
 * Notification signs the `/t/o` and `/t/c` tokens, ingestion verifies them, and neither owns the key
 * (Architecture §2.1). This is the only way either of them gets it.
 */
describe('Serving the email-tracking token key', () => {
    describe('given the key is configured', () => {
        it('then it is returned to the calling service', () => {
            expect(controllerWith(KEY).trackingTokenKey()).toEqual({ key: KEY });
        });
    });

    describe('given no key is configured', () => {
        it('then it is a 503, so no caller mistakes "no key" for a key', () => {
            expect(() => controllerWith(undefined).trackingTokenKey()).toThrow(ServiceUnavailableException);
        });
    });

    describe('given the route metadata', () => {
        const reflector = new Reflector();
        const metadata = (key: string): unknown => reflector.get(key, InternalTrackingKeyController.prototype.trackingTokenKey);

        it('then only services granted tracking_token.read are admitted', () => {
            expect(metadata(SERVICE_CAPABILITIES_KEY)).toEqual([ServiceCapability.TRACKING_TOKEN_READ]);
        });

        it('then no dashboard session can reach it — it would be a way to forge touches', () => {
            expect(metadata(PERMISSIONS_KEY)).toBeUndefined();
            expect(metadata(PLATFORM_ADMIN_KEY)).toBeUndefined();
        });
    });
});
