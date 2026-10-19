import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { AllowServices } from '@common/auth/require-permission.decorator';
import { ConnectionProvider, InternalConnectionDto, isConnectionProvider } from '@domains/connection';

import { ConnectionService } from './connection.service';

/**
 * What Event Ingestion reads to verify a provider callback (Product Spec §12 lists "connection config
 * and tracking-token key (cache from Identity & Access)" among Event Ingestion's inputs).
 *
 * Ingestion caches the result and drops its entry on `connection.created|revoked`, so this is a
 * cache-miss path rather than a per-callback call. It is the one endpoint that returns a decrypted
 * secret, which is why it is service-token-only and carries its own capability instead of reusing
 * `tenant_entitlements.read`.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller({ path: 'internal/connections', version: '1' })
export class InternalConnectionController {
    constructor(private readonly connections: ConnectionService) {}

    @ApiOperation({ summary: 'Resolve a provider connection and its signing secret for callback verification' })
    @ApiOkResponse({ type: InternalConnectionDto })
    @AllowServices(ServiceCapability.PROVIDER_CONNECTION_READ)
    @HttpCode(HttpStatus.OK)
    @Get(':provider/:connectionId')
    async findForReceiver(@Param('provider') provider: string, @Param('connectionId') connectionId: string): Promise<InternalConnectionDto> {
        // An unknown provider is as unresolvable as an unknown connection, and the receiver owes the
        // caller a 404 either way (API Contract §6.5) — not a validation error naming the valid set.
        const connection = isConnectionProvider(provider)
            ? await this.connections.findForReceiver(provider as ConnectionProvider, connectionId)
            : null;
        if (!connection) {
            throw new NotFoundException(`Unknown connection: ${provider}/${connectionId}`);
        }
        return connection;
    }
}
