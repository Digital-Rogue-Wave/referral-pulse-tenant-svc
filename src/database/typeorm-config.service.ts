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
            type: this.configService.getOrThrow('databaseConfig.type', { infer: true }),
            url: this.configService.get('databaseConfig.url', { infer: true }),
            host: this.configService.get('databaseConfig.host', { infer: true }),
            port: this.configService.get('databaseConfig.port', { infer: true }),
            username: this.configService.get('databaseConfig.username', { infer: true }),
            password: this.configService.get('databaseConfig.password', { infer: true }),
            database: this.configService.get('databaseConfig.name', { infer: true }),
            synchronize: false,
            migrationsRun: false,
            namingStrategy: new SnakeNamingStrategy(),
            dropSchema: false,
            keepConnectionAlive: true,
            logging: this.configService.get('appConfig.nodeEnv', { infer: true }) !== 'production',
            entities: [__dirname + '/../**/*.entity{.ts,.js}'],
            migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
            cli: {
                entitiesDir: 'src',
                migrationsDir: 'src/database/migrations',
                subscribersDir: 'src/common/repository/subscribers/'
            },
            extra: {
                max: this.configService.get('databaseConfig.maxConnections', { infer: true }),
                ssl: this.configService.get('databaseConfig.sslEnabled', { infer: true })
                    ? {
                          rejectUnauthorized: this.configService.get('databaseConfig.rejectUnauthorized', { infer: true }),
                          ca: this.configService.get('databaseConfig.ca', { infer: true }) ?? undefined,
                          key: this.configService.get('databaseConfig.key', { infer: true }) ?? undefined,
                          cert: this.configService.get('databaseConfig.cert', { infer: true }) ?? undefined
                      }
                    : undefined
            }
        } as TypeOrmModuleOptions;
    }
}
