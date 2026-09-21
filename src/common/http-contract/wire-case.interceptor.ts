import { CallHandler, CustomDecorator, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Request } from 'express';
import { Observable, map } from 'rxjs';

import { camelCaseKeys, snakeCaseKeys } from './wire-case';

export const RAW_WIRE_KEY = 'http:raw_wire';

/**
 * Exempts a route from key-case conversion — for payloads whose shape is defined by someone else
 * (Stripe and Ory web hooks) or that are already in wire shape (JWKS, the gateway token exchange).
 */
export const RawWire = (): CustomDecorator<string> => SetMetadata(RAW_WIRE_KEY, true);

/**
 * snake_case on the wire, camelCase inside (API Contract v1.3 §1). Runs before the ValidationPipe, so DTOs
 * are validated in their camelCase form, and maps the handler's result back to snake_case. Error bodies
 * are produced by the exception filter directly in wire shape and never pass through here.
 */
@Injectable()
export class WireCaseInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType() !== 'http' || this.reflector.getAllAndOverride<boolean>(RAW_WIRE_KEY, [context.getHandler(), context.getClass()])) {
            return next.handle();
        }

        const request = context.switchToHttp().getRequest<Request>();
        if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
            request.body = camelCaseKeys(request.body);
        }
        // Express 5 exposes `query` through a getter; redefine it on the request instance.
        Object.defineProperty(request, 'query', { value: camelCaseKeys(request.query), writable: true, configurable: true, enumerable: true });

        return next.handle().pipe(map((body: unknown) => snakeCaseKeys(body)));
    }
}
