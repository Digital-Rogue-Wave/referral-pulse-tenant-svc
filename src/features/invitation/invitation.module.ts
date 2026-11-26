import { Module } from '@nestjs/common';

import { PlanLimitModule } from '@app/features/billing/plan-limit.module';

import { UsersModule } from '@app/features/users/users.module';

import { InvitationController, PublicInvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';
import { UserInvitationController } from './user-invitation.controller';

@Module({
    imports: [UsersModule, PlanLimitModule],
    controllers: [InvitationController, PublicInvitationController, UserInvitationController],
    providers: [InvitationService],
    exports: [InvitationService]
})
export class InvitationModule {}
