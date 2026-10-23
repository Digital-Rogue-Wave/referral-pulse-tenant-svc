import { Module } from '@nestjs/common';

import { UsersModule } from '@app/features/users/users.module';
import { ServiceTokenProvider } from '@common/clients/service-token.provider';

import { ConsentConsumer } from './consent.consumer';
import { ConsentService } from './consent.service';
import { DsrController } from './dsr.controller';
import { DsrFanOutService } from './dsr-fanout.service';
import { DsrFanOutWorker } from './dsr-fanout.worker';
import { DsrService } from './dsr.service';
import { ErasureClient } from './erasure.client';

/**
 * Compliance — the consent registry, the DSR endpoint, the erasure fan-out and the compliance events,
 * which Product Spec R-CPL-01 assigns to this service as the platform's one coordinating owner.
 *
 * `UsersModule` is imported for `OperatorErasureService`: Identity's share of an erasure is this
 * service's own, so the fan-out calls the handler directly rather than over HTTP to itself.
 */
@Module({
    imports: [UsersModule],
    controllers: [DsrController],
    providers: [DsrService, DsrFanOutService, DsrFanOutWorker, ErasureClient, ServiceTokenProvider, ConsentService, ConsentConsumer],
    exports: [DsrService]
})
export class ComplianceModule {}
