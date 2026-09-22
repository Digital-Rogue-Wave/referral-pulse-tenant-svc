import { Module } from '@nestjs/common';

import { PlanLimitModule } from '@app/features/billing/plan-limit.module';

import { KetoReconcilerWorker } from './keto-reconciler.worker';
import { OperatorContactController } from './operator-contact.controller';
import { OperatorErasureController } from './operator-erasure.controller';
import { OperatorErasureService } from './operator-erasure.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

/**
 * Users (Identity) module — owns the platform user/role projection and the /v1/users/me read-side.
 * Owns users/user_roles (membership + role) and emits the user.* event contract.
 * See referralai_db_tables_per_service.md and referralai_api_contract.
 */
@Module({
    imports: [PlanLimitModule],
    controllers: [UsersController, OperatorErasureController, OperatorContactController],
    providers: [UsersService, OperatorErasureService, KetoReconcilerWorker],
    exports: [UsersService]
})
export class UsersModule {}
