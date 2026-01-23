import { Module, Global } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { addTransactionalDataSource } from 'typeorm-transactional';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import type { AllConfigType } from '@app/config/config.type';

@Global()
@Module({
    imports: [
        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService<AllConfigType>): TypeOrmModuleOptions => ({
                type: configService.getOrThrow('database.type', { infer: true }),
                host: configService.getOrThrow('database.host', { infer: true }),
                port: configService.getOrThrow('database.port', { infer: true }),
                username: configService.getOrThrow('database.username', { infer: true }),
                password: configService.getOrThrow('database.password', { infer: true }),
                database: configService.getOrThrow('database.name', { infer: true }),
                synchronize: configService.getOrThrow('database.synchronize', { infer: true }),
                logging: configService.getOrThrow('database.logging', { infer: true }),
                poolSize: configService.getOrThrow('database.maxConnections', { infer: true }),
                ssl: configService.getOrThrow('database.sslEnabled', { infer: true })
                    ? { rejectUnauthorized: configService.getOrThrow('database.rejectUnauthorized', { infer: true }) }
                    : false,
                namingStrategy: new SnakeNamingStrategy(),
                autoLoadEntities: true,
            } as TypeOrmModuleOptions),
            dataSourceFactory: async (options: DataSourceOptions | undefined) => {
                if (!options) throw new Error('DataSource options required');
                const dataSource = new DataSource(options);
                await dataSource.initialize();
                addTransactionalDataSource(dataSource);
                return dataSource;
            },
        }),
    ],
    exports: [TypeOrmModule],
})
export class DatabaseModule {}
