import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IAuthenticatedUser } from '@app/types';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { AllowServices } from '@common/auth/require-permission.decorator';
import {
    ConnectionProvider,
    InternalConnectionCredentialDto,
    InternalConnectionDto,
    InternalConnectionVerifiedDto,
    isConnectionProvider
} from '@domains/connection';

import { ConnectionService } from './connection.service';

/**
 * The service-token-only connection routes, each under its own capability so no caller gets more than it needs:
 * - Event Ingestion reads the inbound signing secret to verify callbacks (`provider_connection.read`) and reports the
 *   first verified one (`connection_status.write`);
 * - reward- and notification-service read an outbound credential for one call (`connection_credential.read`, audited).
 *
 * `:connectionId/credential` is declared before `:provider/:connectionId`, which would otherwise take it.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller({ path: 'internal/connections', version: '1' })
export class InternalConnectionController {
    constructor(private readonly connections: ConnectionService) {}

    @ApiOperation({ summary: 'The outbound credential of a connection, for one provider call (audited)' })
    @ApiOkResponse({ type: InternalConnectionCredentialDto })
    @AllowServices(ServiceCapability.CONNECTION_CREDENTIAL_READ)
    @HttpCode(HttpStatus.OK)
    @Get(':connectionId/credential')
    async credential(
        @Param('connectionId') connectionId: string,
        @CurrentUser() caller: IAuthenticatedUser
    ): Promise<InternalConnectionCredentialDto> {
        return found(await this.connections.credentialFor(connectionId, clientOf(caller)), connectionId);
    }

    @ApiOperation({ summary: "Report a connection's first signature-verified callback; activates a pending connection" })
    @ApiOkResponse({ type: InternalConnectionVerifiedDto })
    @AllowServices(ServiceCapability.CONNECTION_STATUS_WRITE)
    @HttpCode(HttpStatus.OK)
    @Post(':connectionId/verified')
    async verified(@Param('connectionId') connectionId: string, @CurrentUser() caller: IAuthenticatedUser): Promise<InternalConnectionVerifiedDto> {
        return found(await this.connections.markVerifiedByCallback(connectionId, clientOf(caller)), connectionId);
    }

    @ApiOperation({ summary: 'Resolve a connection and its inbound signing secret for callback verification' })
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
        return found(connection, `${provider}/${connectionId}`);
    }
}

const clientOf = (caller: IAuthenticatedUser): string => caller.clientId ?? caller.userId;

function found<T>(value: T | null, what: string): T {
    if (!value) {
        throw new NotFoundException(`Unknown connection: ${what}`);
    }
    return value;
}
