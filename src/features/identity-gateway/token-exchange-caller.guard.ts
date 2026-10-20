import { timingSafeEqual } from 'crypto';

import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

import type { Request } from 'express';

import type { IAuthenticatedUser } from '@app/types';

import { AuthorizationService } from '@common/auth/authz/authorization.service';
import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';

import type { AllConfigType } from '@config/config.type';

/** Which of the two callers was proven, recorded so the handler reads the credential from the right place. */
export type TokenExchangeCaller = 'gateway' | 'service';

export interface RequestWithExchangeCaller extends Request {
    tokenExchangeCaller?: TokenExchangeCaller;
}

/**
 * Who may call `GET /internal/validate-token`.
 *
 * Two callers, two proofs, because the endpoint has two legitimate ones:
 *
 * - **The gateway** (Traefik forwardAuth) presents `X-Gateway-Secret` and puts the credential being
 *   exchanged in `Authorization`, because that is the header it forwards from the original request.
 * - **A service** presents its own Hydra token in `Authorization` and the credential in `X-Api-Key`,
 *   and must hold `token_exchange.call`.
 *
 * The split exists because the endpoint previously accepted *only* the gateway secret, which locked
 * out the caller Architecture §13.1 and §12.1 both name: Event Ingestion, the one service that
 * receives API keys (Product Spec R-SDK-07). Every SDK and backend event answered 401 as a result.
 * Giving ingestion the gateway's shared secret would have worked too, but then the secret no longer
 * proves the caller *is* the gateway, and rotating it becomes a coordinated redeploy of every holder.
 *
 * Note that `X-Gateway-Secret` is this implementation's own: no v5 document mentions it. It is kept
 * because removing it would let anything that reaches the internal network mint an internal JWT for a
 * credential, and this is the endpoint the platform's whole auth chain hangs from.
 */
@Injectable()
export class TokenExchangeCallerGuard implements CanActivate {
    private readonly gatewaySecret: Buffer;

    constructor(
        configService: ConfigService<AllConfigType>,
        private readonly authorization: AuthorizationService,
        private readonly logger: AppLoggerService
    ) {
        this.gatewaySecret = Buffer.from(configService.getOrThrow('tokenIssuer.gatewaySecret', { infer: true }));
        this.logger.setContext(TokenExchangeCallerGuard.name);
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<RequestWithExchangeCaller>();
        const presentedSecret = request.headers['x-gateway-secret'] as string | undefined;

        // The gateway path is tried first and only when the header is present at all, so a service
        // caller is never measured against the secret and never learns anything from the timing.
        if (presentedSecret !== undefined) {
            this.assertGatewaySecret(presentedSecret);
            request.tokenExchangeCaller = 'gateway';
            return true;
        }

        await this.assertServiceCaller(context);
        request.tokenExchangeCaller = 'service';
        return true;
    }

    private assertGatewaySecret(presented: string): void {
        const candidate = Buffer.from(presented);
        if (candidate.length !== this.gatewaySecret.length || !timingSafeEqual(candidate, this.gatewaySecret)) {
            throw new BaseException('authentication_error', 'Unknown caller', HttpStatus.UNAUTHORIZED);
        }
    }

    /**
     * Invokes the usual JWT strategy, which sets `request.user`. Separate from the capability check
     * below so a test can substitute it: the route is `@Public()` so the global JWT guard skips it —
     * the gateway's `Authorization` holds a credential, not a token, and would never verify — which is
     * why passport has to be invoked here rather than declared.
     */
    protected async authenticate(context: ExecutionContext): Promise<void> {
        const PassportGuard = AuthGuard('jwt');
        await new PassportGuard().canActivate(context);
    }

    /** Verifies the caller's own token, then checks the capability live in Keto. */
    private async assertServiceCaller(context: ExecutionContext): Promise<void> {
        await this.authenticate(context);

        const user = context.switchToHttp().getRequest<Request>().user as IAuthenticatedUser | undefined;
        if (!user?.isServiceToken) {
            throw new BaseException('authentication_error', 'Unknown caller', HttpStatus.UNAUTHORIZED);
        }

        const clientId = user.clientId ?? user.userId;
        if (!(await this.authorization.serviceHas(clientId, ServiceCapability.TOKEN_EXCHANGE_CALL))) {
            this.logger.warn('Service principal denied at the token exchange', { clientId });
            throw new BaseException('authorization_error', 'This service is not authorized to exchange credentials', HttpStatus.FORBIDDEN);
        }
    }
}
