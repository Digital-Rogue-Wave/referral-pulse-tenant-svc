import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { AllowServices } from '@common/auth/require-permission.decorator';
import { TrackingTokenKeyDto } from '@domains/connection';

import type { AllConfigType } from '@config/config.type';

/**
 * The email-tracking token key (Architecture v5 §2.1 puts it in this service; Product Spec §12 has
 * Event Ingestion caching it from here). Notification-service signs the `/t/o/{token}` and
 * `/t/c/{token}` tokens with it at send time and ingestion verifies them when the recipient opens or
 * clicks, so the two services must agree on one value — which is the reason it lives in neither.
 *
 * Service tokens only, under its own capability. There is no tenant-facing route: no operator needs
 * this value, and an endpoint that returns it to a dashboard session would be a way to mint tracking
 * events for someone else's tenant.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller({ path: 'internal/tracking-token-key', version: '1' })
export class InternalTrackingKeyController {
    constructor(private readonly configService: ConfigService<AllConfigType>) {}

    @ApiOperation({ summary: 'The key email-tracking tokens are signed and verified with' })
    @ApiOkResponse({ type: TrackingTokenKeyDto })
    @AllowServices(ServiceCapability.TRACKING_TOKEN_READ)
    @HttpCode(HttpStatus.OK)
    @Get()
    trackingTokenKey(): TrackingTokenKeyDto {
        const key = this.configService.get('connectionConfig.trackingTokenKey', { infer: true });
        if (!key) {
            // 503 rather than 500 or an empty string: the caller's correct response is to fail the
            // request and retry, not to treat "no key" as a key and accept unsigned tokens.
            throw new ServiceUnavailableException('TRACKING_TOKEN_KEY is not configured');
        }
        return { key };
    }
}
