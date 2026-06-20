import { Module } from '@nestjs/common';

import { UsersModule } from '@app/features/users/users.module';

import { InvitationController, PublicInvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';

@Module({
    imports: [UsersModule],
    controllers: [InvitationController, PublicInvitationController],
    providers: [InvitationService],
    exports: [InvitationService]
})
export class InvitationModule {}
