import { createServer, type Server } from 'node:http';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';

/**
 * Probe endpoints for worker pods (APP_MODE=worker), which serve no API. Answers only
 * `GET /health/live` (the process and its event loop respond) and `GET /health/ready` (Postgres and Redis,
 * which every job needs, are reachable); anything else is 404.
 */
@Injectable()
export class WorkerHealthServer implements OnApplicationShutdown {
    private server: Server | null = null;

    constructor(
        private readonly prisma: DatabaseService,
        private readonly redis: RedisService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(WorkerHealthServer.name);
    }

    start(port: number): Promise<void> {
        this.server = createServer((req, res) => {
            void this.respond(req.method, req.url).then(({ status, body }) => {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(body));
            });
        });
        return new Promise((resolve) => this.server!.listen(port, resolve));
    }

    async respond(method: string | undefined, url: string | undefined): Promise<{ status: number; body: object }> {
        if (method !== 'GET') {
            return { status: 405, body: { status: 'error' } };
        }
        if (url === '/health/live') {
            return { status: 200, body: { status: 'ok' } };
        }
        if (url === '/health/ready') {
            const [database, redis] = await Promise.all([this.check(() => this.prisma.$queryRaw`SELECT 1`), this.check(() => this.redis.ping())]);
            const ready = database && redis;
            return { status: ready ? 200 : 503, body: { status: ready ? 'ok' : 'error', info: { database: up(database), redis: up(redis) } } };
        }
        return { status: 404, body: { status: 'error' } };
    }

    onApplicationShutdown(): Promise<void> {
        return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    }

    private async check(probe: () => Promise<unknown>): Promise<boolean> {
        try {
            await probe();
            return true;
        } catch (error) {
            this.logger.warn('Worker readiness check failed', { reason: error instanceof Error ? error.message : 'unknown' });
            return false;
        }
    }
}

const up = (ok: boolean) => ({ status: ok ? 'up' : 'down' });
