import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

import { BaseException } from '@common/exceptions/base.exceptions';

import type { AllConfigType } from '@config/config.type';

/**
 * Authenticates Ory Kratos web hooks by their `X-Ory-Api-Key` shared secret, compared in constant time.
 * The secret is mandatory config, so the check can never be silently switched off.
 */
@Injectable()
export class OryWebhookGuard implements CanActivate {
    private readonly secret: Buffer;

    constructor(configService: ConfigService<AllConfigType>) {
        this.secret = Buffer.from(configService.getOrThrow('oryConfig.webhookApiKey', { infer: true }));
    }

    canActivate(context: ExecutionContext): boolean {
        const presented = Buffer.from(context.switchToHttp().getRequest<Request>().header('x-ory-api-key') ?? '');
        if (presented.length !== this.secret.length || !timingSafeEqual(presented, this.secret)) {
            throw new BaseException('authentication_error', 'Invalid webhook credentials', HttpStatus.UNAUTHORIZED);
        }
        return true;
    }
}
