import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { AllConfigType } from '@mod/config/config.type';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
    constructor(private configService: ConfigService<AllConfigType>) {}

    createTypeOrmOptions(): TypeOrmModuleOptions {
        return {
            type: this.configService.getOrThrow('database.type', { infer: true }),
            url: this.configService.get('database.url', { infer: true }),
            host: this.configService.get('database.host', { infer: true }),
            port: this.configService.get('database.port', { infer: true }),
            username: this.configService.get('database.username', { infer: true }),
            password: this.configService.get('database.password', { infer: true }),
            database: this.configService.get('database.name', { infer: true }),
            synchronize: false,
            migrationsRun: false,
            namingStrategy: new SnakeNamingStrategy(),
            dropSchema: false,
            keepConnectionAlive: true,
            logging: this.configService.get('app.nodeEnv', { infer: true }) !== 'production',
            entities: [__dirname + '/../**/*.entity{.ts,.js}'],
            migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
            cli: {
                entitiesDir: 'src',
                migrationsDir: 'src/database/migrations',
                subscribersDir: 'src/common/repository/subscribers/',
            },
            extra: {
                max: this.configService.get('database.maxConnections', { infer: true }),
                ssl: this.configService.get('database.sslEnabled', { infer: true })
                    ? {
                        rejectUnauthorized: this.configService.get('database.rejectUnauthorized', { infer: true }),
                        ca: this.configService.get('database.ca', { infer: true }) ?? undefined,
                        key: this.configService.get('database.key', { infer: true }) ?? undefined,
                        cert: this.configService.get('database.cert', { infer: true }) ?? undefined,
                    }
                    : undefined,
            },
        } as TypeOrmModuleOptions;
    }
}
