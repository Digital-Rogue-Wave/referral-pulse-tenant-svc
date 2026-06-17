import { Module } from '@nestjs/common';

import { InvitationController, PublicInvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';

@Module({
    controllers: [InvitationController, PublicInvitationController],
    providers: [InvitationService],
    exports: [InvitationService]
})
export class InvitationModule {}
