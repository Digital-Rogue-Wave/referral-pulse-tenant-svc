import { Module } from '@nestjs/common';

import { ApiKeyModule } from '@app/features/api-key/api-key.module';

import { CredentialResolverService } from './credential-resolver.service';
import { IdentityGatewayController } from './identity-gateway.controller';
import { InternalTokenService } from './internal-token.service';
import { TokenExchangeCallerGuard } from './token-exchange-caller.guard';

/**
 * Credential exchange for the gateway (Architecture §13.1): API keys and Hydra user tokens in,
 * internal JWT out, plus the JWKS that verifies it.
 */
@Module({
    imports: [ApiKeyModule],
    controllers: [IdentityGatewayController],
    providers: [CredentialResolverService, InternalTokenService, TokenExchangeCallerGuard]
})
export class IdentityGatewayModule {}
