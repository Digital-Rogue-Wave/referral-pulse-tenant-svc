import { Module } from '@nestjs/common';

import { PlanLimitModule } from '@app/features/billing/plan-limit.module';

import { UsersModule } from '@app/features/users/users.module';

import { InvitationController, PublicInvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';

@Module({
    imports: [UsersModule, PlanLimitModule],
    controllers: [InvitationController, PublicInvitationController],
    providers: [InvitationService],
    exports: [InvitationService]
})
export class InvitationModule {}
