import { Module } from '@nestjs/common';

import { ConnectionController } from './connection.controller';
import { ConnectionService } from './connection.service';
import { InternalConnectionController } from './internal-connection.controller';
import { InternalTrackingKeyController } from './internal-tracking-key.controller';
import { ProviderSecretCipher } from './provider-secret.cipher';

@Module({
    controllers: [ConnectionController, InternalConnectionController, InternalTrackingKeyController],
    providers: [ConnectionService, ProviderSecretCipher],
    exports: [ConnectionService]
})
export class ConnectionModule {}
