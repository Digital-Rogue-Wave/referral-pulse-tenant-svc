import { Module } from '@nestjs/common';

import { KetoReconcilerWorker } from './keto-reconciler.worker';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

/**
 * Users (Identity) module — owns the platform user/role projection and the /v1/users/me read-side.
 * Owns users/user_roles (membership + role) and emits the user.* event contract.
 * See referralai_db_tables_per_service.md and referralai_api_contract.
 */
@Module({
    controllers: [UsersController],
    providers: [UsersService, KetoReconcilerWorker],
    exports: [UsersService]
})
export class UsersModule {}
