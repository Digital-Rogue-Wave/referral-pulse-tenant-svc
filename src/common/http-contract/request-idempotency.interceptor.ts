import { CallHandler, CustomDecorator, ExecutionContext, HttpStatus, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma-gen/generated/client';

import type { Request, Response } from 'express';
import { from, map, Observable, of, switchMap, catchError, throwError } from 'rxjs';

import type { IAuthenticatedUser } from '@app/types';
import { IS_PUBLIC_KEY } from '@app/types';

import { BaseException } from '@common/exceptions/base.exceptions';
import { sha256Hex } from '@common/helper/hashing';
import { DatabaseService } from '@app/database/database.service';

/** API Contract v1.3 §1: request-level dedup window. */
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const KEY_FORMAT = /^[\x21-\x7e]{1,255}$/;
const IDEMPOTENT_METHODS = new Set(['POST', 'PATCH']);

export const SKIP_IDEMPOTENCY_KEY = 'http:skip_idempotency';

/** For POST routes that dedupe on their own business key (provider web hooks are already @Public). */
export const SkipIdempotency = (): CustomDecorator<string> => SetMetadata(SKIP_IDEMPOTENCY_KEY, true);

type Claim = { replay: { status: number; body: unknown } } | { claimed: true };

/**
 * `Idempotency-Key` for every non-ingestion POST and PATCH (API Contract v1.3 §1, DB Model v2 §0.7).
 *
 * - Required from dashboard callers; optional for service callers, which dedupe on business keys.
 * - Same key + same request within 24 h → the original response, verbatim (`Idempotent-Replayed: true`).
 * - Same key + a different request → 409 `idempotency_key_collision`.
 * - Same key while the first request is still running → 409 `idempotency_key_in_flight` + `Retry-After`.
 * - A failed request releases its key so the client can retry.
 *
 * Registered outermost, so the fingerprint covers the raw wire body and the stored response is the final
 * wire response.
 */
@Injectable()
export class RequestIdempotencyInterceptor implements NestInterceptor {
    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: DatabaseService
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const targets = [context.getHandler(), context.getClass()];
        const request = context.switchToHttp().getRequest<Request>();
        if (
            context.getType() !== 'http' ||
            !IDEMPOTENT_METHODS.has(request.method) ||
            this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
            this.reflector.getAllAndOverride<boolean>(SKIP_IDEMPOTENCY_KEY, targets)
        ) {
            return next.handle();
        }

        const principal = request.user as IAuthenticatedUser | undefined;
        const key = request.header('idempotency-key');
        if (!key) {
            if (principal?.isServiceToken) {
                return next.handle();
            }
            throw new BaseException(
                'idempotency_key_required',
                'The Idempotency-Key header is required for this request',
                HttpStatus.BAD_REQUEST,
                'Idempotency-Key'
            );
        }
        if (!KEY_FORMAT.test(key)) {
            throw new BaseException(
                'invalid_request',
                'Idempotency-Key must be 1–255 printable characters',
                HttpStatus.BAD_REQUEST,
                'Idempotency-Key'
            );
        }

        const scope = this.scopeOf(principal);
        const fingerprint = sha256Hex(`${request.method} ${request.originalUrl.split('?')[0]} ${JSON.stringify(request.body ?? null)}`);
        const response = context.switchToHttp().getResponse<Response>();

        return from(this.claim(scope, key, fingerprint)).pipe(
            switchMap((claim) => {
                if ('replay' in claim) {
                    response.setHeader('Idempotent-Replayed', 'true');
                    response.status(claim.replay.status);
                    return of(claim.replay.body);
                }
                // The stored response is written before the client sees it: a key never stays "in flight" after a
                // request that actually finished.
                return next.handle().pipe(
                    switchMap((body) => from(this.complete(scope, key, this.statusOf(context), body)).pipe(map(() => body))),
                    catchError((error: unknown) => from(this.release(scope, key)).pipe(switchMap(() => throwError(() => error))))
                );
            })
        );
    }

    private async claim(scope: string, key: string, fingerprint: string): Promise<Claim> {
        const now = new Date();
        try {
            await this.prisma.idempotencyKey.create({
                data: {
                    tenantId: scope,
                    idempotencyKey: key,
                    requestFingerprint: fingerprint,
                    expiresAt: new Date(now.getTime() + IDEMPOTENCY_WINDOW_MS)
                }
            });
            return { claimed: true };
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
                throw error;
            }
        }

        const existing = await this.prisma.idempotencyKey.findUnique({
            where: { tenantId_idempotencyKey: { tenantId: scope, idempotencyKey: key } }
        });
        if (!existing || existing.expiresAt <= now) {
            // Expired (the sweeper had not removed it yet): start a fresh window.
            await this.prisma.idempotencyKey.deleteMany({ where: { tenantId: scope, idempotencyKey: key, expiresAt: { lte: now } } });
            return this.claim(scope, key, fingerprint);
        }
        if (existing.requestFingerprint !== fingerprint) {
            throw new BaseException(
                'idempotency_key_collision',
                'This Idempotency-Key was already used with a different request',
                HttpStatus.CONFLICT,
                'Idempotency-Key'
            );
        }
        if (existing.responseStatus === null) {
            throw new BaseException(
                'idempotency_key_in_flight',
                'A request with this Idempotency-Key is still being processed',
                HttpStatus.CONFLICT,
                undefined,
                {
                    retryAfterSeconds: 1
                }
            );
        }
        return { replay: { status: existing.responseStatus, body: existing.responseBody } };
    }

    private async complete(scope: string, key: string, status: number, body: unknown): Promise<void> {
        const targetResourceId = typeof (body as { id?: unknown } | null)?.id === 'string' ? (body as { id: string }).id : null;
        await this.prisma.idempotencyKey.update({
            where: { tenantId_idempotencyKey: { tenantId: scope, idempotencyKey: key } },
            data: { responseStatus: status, responseBody: (body ?? Prisma.JsonNull) as Prisma.InputJsonValue, targetResourceId }
        });
    }

    private async release(scope: string, key: string): Promise<void> {
        await this.prisma.idempotencyKey.deleteMany({ where: { tenantId: scope, idempotencyKey: key, responseStatus: null } });
    }

    /** The status the route answers with — `@HttpCode` or Nest's default (201 for POST, 200 otherwise). */
    private statusOf(context: ExecutionContext): number {
        const declared = this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler());
        return declared ?? (context.switchToHttp().getRequest<Request>().method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
    }

    private scopeOf(principal: IAuthenticatedUser | undefined): string {
        if (principal?.tenantId) {
            return principal.tenantId;
        }
        if (principal?.identityId) {
            return `identity:${principal.identityId}`;
        }
        return `service:${principal?.clientId ?? 'anonymous'}`;
    }
}
