import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';

import { Prisma, PrismaClient } from '@prisma-gen/generated/client';
import { ConfigType } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

import databaseConfig from '@config/database.config';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';

const { Pool } = pg;

/** Transaction options matching Prisma's interactive transaction API */
type TransactionOptions = {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
};

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit {
    constructor(
        @Inject(forwardRef(() => TransactionEventEmitterService))
        private readonly txEventEmitter: TransactionEventEmitterService,
        @Inject(databaseConfig.KEY)
        private readonly dbConfig: ConfigType<typeof databaseConfig>
    ) {
        // In Prisma 7.x, the datasources option was removed.
        // Use the @prisma/adapter-pg adapter with a PostgreSQL connection pool.
        const pool = new Pool({
            connectionString: dbConfig.url,
            max: dbConfig.maxConnections
        });
        const adapter = new PrismaPg(pool);

        super({
            adapter,
            log: dbConfig.logging ? ['query', 'info', 'warn', 'error'] : ['info', 'warn', 'error']
        });
    }

    async onModuleInit() {
        await this.$connect();
    }

    /**
     * Override $transaction to support event emission after successful commit.
     * Delegates to TransactionEventEmitterService for transaction handling.
     *
     * Supports both sequential (array of promises) and interactive (callback) forms.
     */
    override async $transaction<T>(arg: Prisma.PrismaPromise<T>[]): Promise<T[]>;
    override async $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions): Promise<T>;
    override async $transaction<T>(
        arg: Prisma.PrismaPromise<T>[] | ((tx: Prisma.TransactionClient) => Promise<T>),
        options?: TransactionOptions
    ): Promise<T | T[]> {
        return this.txEventEmitter.transaction(this as unknown as PrismaClient, arg, options);
    }
}
