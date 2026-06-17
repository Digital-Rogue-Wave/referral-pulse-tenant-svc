import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createClient, ClickHouseClient } from '@clickhouse/client';

import { AppLoggerService } from '@common/logging/app-logger.service';

import { AllConfigType } from '@config/config.type';

@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
    private client!: ClickHouseClient;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(ClickHouseService.name);
    }

    onModuleInit() {
        const config = this.configService.getOrThrow('clickhouse', { infer: true });

        this.client = createClient({
            host: `${config.protocol}://${config.host}:${config.port}`,
            username: config.user,
            password: config.pass,
            database: config.db
        });

        this.logger.log(`ClickHouse client initialized for ${config.host}:${config.port}`);
    }

    async onModuleDestroy() {
        if (this.client) {
            await this.client.close();
        }
    }

    /**
     * Executes a query against ClickHouse.
     */
    async query<T = any>(query: string): Promise<T[]> {
        try {
            const resultSet = await this.client.query({
                query,
                format: 'JSONEachRow'
            });
            return resultSet.json<T>();
        } catch (error) {
            this.logger.error(`ClickHouse query failed: ${query}`, (error as Error).stack);
            throw error;
        }
    }

    /**
     * Inserts data into ClickHouse.
     */
    async insert<T = any>(table: string, values: T[]): Promise<void> {
        try {
            await this.client.insert({
                table,
                values,
                format: 'JSONEachRow'
            });
            this.logger.debug(`Inserted ${values.length} rows into ClickHouse table: ${table}`);
        } catch (error) {
            this.logger.error(`ClickHouse insert failed for table: ${table}`, (error as Error).stack);
            throw error;
        }
    }

    /**
     * Performs a health check against ClickHouse.
     */
    async healthCheck(): Promise<boolean> {
        try {
            await this.client.ping();
            return true;
        } catch (error) {
            this.logger.error('ClickHouse health check failed', (error as Error).stack);
            return false;
        }
    }
}
