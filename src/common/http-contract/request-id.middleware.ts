import type { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulid';

/** A caller-supplied id is kept only if it is short and printable, so it is safe to log and echo back. */
const ACCEPTABLE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * `request_id` on every response (API Contract v1.3 §1): taken from `X-Request-Id` when the gateway sent a
 * sane one, generated otherwise (`req_<ulid>`), and set before guards run so even an authentication failure
 * carries the id the logs use.
 */
export function requestIdMiddleware(request: Request & { requestId?: string }, response: Response, next: NextFunction): void {
    const presented = request.header('x-request-id');
    const requestId = presented && ACCEPTABLE_ID.test(presented) ? presented : `req_${ulid()}`;
    request.requestId = requestId;
    request.headers['x-request-id'] = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
}
