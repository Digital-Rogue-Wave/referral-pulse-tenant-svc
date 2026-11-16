import { Module } from '@nestjs/common';

import { BreakGlassController } from './break-glass.controller';
import { BreakGlassExpiryWorker } from './break-glass-expiry.worker';
import { BreakGlassService } from './break-glass.service';

/** Break-glass access for Super Admins (Product Spec R-ACT-02, E1 D17). */
@Module({
    controllers: [BreakGlassController],
    providers: [BreakGlassService, BreakGlassExpiryWorker],
    exports: [BreakGlassService]
})
export class BreakGlassModule {}
