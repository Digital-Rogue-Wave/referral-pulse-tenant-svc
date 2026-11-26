import { Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

import { Prisma, PrismaClient } from '@prisma-gen/generated/client';

import databaseConfig from '@config/database.config';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';

type TransactionOptions = {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
};

/**
 * The privileged connection (v5.2 DB Model §0.8): the role that bypasses row-level security, for the paths that must
 * work before a tenant is known or across tenants — resolving an API key, a Connection or an invitation token, the
 * outbox relay and the sweepers, provider webhooks, the Super Admin console. Injected by name, so every use is
 * visible in review; everything else goes through `DatabaseService`, which the policies bind.
 */
@Injectable()
export class PrivilegedDatabaseService extends PrismaClient implements OnModuleInit {
    constructor(
        @Inject(forwardRef(() => TransactionEventEmitterService))
        private readonly txEventEmitter: TransactionEventEmitterService,
        @Inject(databaseConfig.KEY)
        dbConfig: ConfigType<typeof databaseConfig>
    ) {
        super({ adapter: new PrismaPg(new pg.Pool({ connectionString: dbConfig.privilegedUrl, max: dbConfig.maxConnections })) });
    }

    async onModuleInit(): Promise<void> {
        await this.$connect();
    }

    /** Same commit hooks as `DatabaseService`: events and audit rows of a privileged transaction follow its commit. */
    override async $transaction<T>(arg: Prisma.PrismaPromise<T>[]): Promise<T[]>;
    override async $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions): Promise<T>;
    override async $transaction<T>(
        arg: Prisma.PrismaPromise<T>[] | ((tx: Prisma.TransactionClient) => Promise<T>),
        options?: TransactionOptions
    ): Promise<T | T[]> {
        return this.txEventEmitter.transaction(this as unknown as PrismaClient, arg, options);
    }
}
