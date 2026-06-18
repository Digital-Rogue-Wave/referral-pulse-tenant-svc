import { Module } from '@nestjs/common';

import { ApiKeyModule } from '@app/features/api-key/api-key.module';

import { UserProjectionListener } from './user-projection.listener';
import { TokenResolverService } from './token-resolver.service';
import { UsersService } from './users.service';
import { InternalAuthController } from './internal-auth.controller';
import { UsersController } from './users.controller';

/**
 * Users (Identity) module — owns the platform user/role projection, the
 * /v1/users/me read-side, and the internal /v1/internal/validate-token resolver.
 * Projects users/user_roles from the team-member lifecycle and emits user.* events.
 * See referralai_db_tables_per_service.md and referralai_api_contract.
 */
@Module({
    imports: [ApiKeyModule],
    controllers: [InternalAuthController, UsersController],
    providers: [UserProjectionListener, TokenResolverService, UsersService]
})
export class UsersModule {}
