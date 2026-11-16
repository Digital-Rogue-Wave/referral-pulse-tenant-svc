import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantModule } from '@app/features/tenant/tenant.module';

import type { AllConfigType } from '@config/config.type';

import { AdminVerificationController } from './admin-verification.controller';
import { AdminVerificationService } from './admin-verification.service';
import { CompanyVerificationService } from './company-verification.service';
import { FakeKybProvider } from './fake-kyb.provider';
import { KYB_PROVIDER } from './kyb-provider';
import { KybResultHandler } from './kyb-result.handler';
import { SumsubKybProvider } from './sumsub-kyb.provider';
import { VerificationEscalationWorker } from './verification-escalation.worker';
import { VerificationController } from './verification.controller';

/** Company verification through a KYB provider, and its Super Admin review (Product Spec R-INT-02, E1 D15). */
@Module({
    imports: [TenantModule],
    controllers: [VerificationController, AdminVerificationController],
    providers: [
        CompanyVerificationService,
        AdminVerificationService,
        KybResultHandler,
        VerificationEscalationWorker,
        SumsubKybProvider,
        FakeKybProvider,
        {
            provide: KYB_PROVIDER,
            inject: [ConfigService, SumsubKybProvider, FakeKybProvider],
            useFactory: (config: ConfigService<AllConfigType>, sumsub: SumsubKybProvider, fake: FakeKybProvider) =>
                config.getOrThrow('kyb', { infer: true }).provider === 'sumsub' ? sumsub : fake
        }
    ],
    exports: [KybResultHandler]
})
export class VerificationModule {}
