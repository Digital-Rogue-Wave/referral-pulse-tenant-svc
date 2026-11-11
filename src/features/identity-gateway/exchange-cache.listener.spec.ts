import { mock, MockProxy } from 'jest-mock-extended';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { UserRemovedEvent, UserRoleChangedEvent } from '@domains/user';

import { CredentialResolverService } from './credential-resolver.service';
import { ExchangeCacheListener } from './exchange-cache.listener';

describe('ExchangeCacheListener (US1.2.4 F1)', () => {
    let credentials: MockProxy<CredentialResolverService>;
    let logger: MockProxy<AppLoggerService>;
    let listener: ExchangeCacheListener;

    beforeEach(() => {
        credentials = mock<CredentialResolverService>();
        logger = mock<AppLoggerService>();
        listener = new ExchangeCacheListener(credentials, logger);
    });

    describe('given user.removed', () => {
        it('then the removed member keeps no cached tenant claims', async () => {
            credentials.forgetUser.mockResolvedValue(1);

            await listener.onUserRemoved(new UserRemovedEvent('u1', 't1', 'analyst'));

            expect(credentials.forgetUser).toHaveBeenCalledWith('u1');
        });
    });

    describe('given user.role_changed', () => {
        it('then the member keeps no cached perms of the old role', async () => {
            credentials.forgetUser.mockResolvedValue(0);

            await listener.onUserRoleChanged(new UserRoleChangedEvent('u1', 't1', 'analyst', 'owner'));

            expect(credentials.forgetUser).toHaveBeenCalledWith('u1');
        });
    });

    describe('given Redis is unreachable', () => {
        it('then the failure is logged, not thrown: the cache still expires with its token', async () => {
            credentials.forgetUser.mockRejectedValue(new Error('ECONNREFUSED'));

            await expect(listener.onUserRemoved(new UserRemovedEvent('u1', 't1', 'analyst'))).resolves.toBeUndefined();

            expect(logger.error).toHaveBeenCalled();
        });
    });
});
