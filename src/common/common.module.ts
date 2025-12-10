import { Global, HttpException, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { S3Client } from '@aws-sdk/client-s3';
import multerS3 from 'multer-s3';
import { MulterModule } from '@nestjs/platform-express';

import { LoggingModule } from '@mod/common/logger/logging.module';
import { HttpClientsModule } from '@mod/common/http/http-clients.module';
import { RedisModule } from '@mod/common/aws-redis/redis.module';
import { HelperModule } from '@mod/common/helpers/helper.module';
import { S3Module } from '@mod/common/aws-s3/s3.module';
import { SqsMessagingModule } from '@mod/common/aws-sqs/sqs.module';
import { SnsModule } from '@mod/common/aws-sqs/sns.module';

import { TracingModule } from '@mod/common/tracing/tracing.module';
import { MonitoringModule } from '@mod/common/monitoring/monitoring.module';

import { IsNotUsedByOthers } from '@mod/common/validators/is-not-used-by-others';
import { IsNotExist } from '@mod/common/validators/is-not-exists.validator';
import { IsExist } from '@mod/common/validators/is-exists.validator';
import { IsDateGreaterThanNowValidator } from '@mod/common/validators/is-date-grater-than-now.validator';
import { EndLaterThanStartDateValidator } from '@mod/common/validators/end-later-than-start-date.validator';
import { CompareDateConstraint } from '@mod/common/validators/compare-date.validator';
import { IsGreaterThanOrEqualConstraint } from '@mod/common/validators/is.greater.than.or.equal.validator';
import { IdempotencyModule } from '@mod/common/idempotency/idempotency.module';
import { RequestIdMiddleware } from '@mod/common/middleware/request-id.middleware';
import { AuthModule } from '@mod/common/auth/auth.module';
import { ClientsModule } from '@mod/common/clients/clients.module';
import { SharedService } from '@mod/common/shared.service';
import { AllConfigType } from '@mod/config/config.type';
import { HeaderResolver, I18nModule } from 'nestjs-i18n';
import path from 'path';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Global()
@Module({
    imports: [
        EventEmitterModule.forRoot(),
        LoggingModule,
        RedisModule,
        HelperModule,
        S3Module,
        SqsMessagingModule.register(),
        SnsModule,
        TracingModule.register(),
        MonitoringModule.register(),
        HttpClientsModule,
        IdempotencyModule,
        AuthModule,
        ClientsModule,
        MulterModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService<AllConfigType>) => {
                const storages = {
                    s3: () => {
                        const s3 = new S3Client({
                            region: configService.getOrThrow('awsConfig.region', { infer: true }),
                            forcePathStyle: configService.getOrThrow('s3Config.forcePathStyle', { infer: true }),
                            endpoint: configService.get('s3Config.endpoint', {
                                infer: true
                            }),
                            credentials: configService.get('s3Config.accessKeyId', { infer: true })
                                ? {
                                      accessKeyId: configService.getOrThrow('s3Config.accessKeyId', {
                                          infer: true
                                      }),
                                      secretAccessKey: configService.getOrThrow('s3Config.secretAccessKey', { infer: true })
                                  }
                                : undefined
                        });

                        return multerS3({
                            s3: s3,
                            bucket: configService.getOrThrow('s3Config.bucket', {
                                infer: true
                            }),
                            contentType: multerS3.AUTO_CONTENT_TYPE,
                            key: (request, file, callback) => {
                                callback(null, `${randomStringGenerator()}.${file.originalname.split('.').pop()?.toLowerCase()}`);
                            }
                        });
                    }
                };
                return {
                    fileFilter: (request, file, callback) => {
                        const allowedExtensions = /\.(jpg|jpeg|png|avif|webp|pdf|xlsx|xls|docx|doc|pptx|ppt)$/i;

                        if (!file.originalname.match(allowedExtensions)) {
                            return callback(
                                new HttpException(
                                    {
                                        status: HttpStatus.UNPROCESSABLE_ENTITY,
                                        errors: {
                                            file: `cantUploadFileType`
                                        }
                                    },
                                    HttpStatus.UNPROCESSABLE_ENTITY
                                ),
                                false
                            );
                        }

                        callback(null, true);
                    },
                    storage: storages['s3'](),
                    limits: {
                        fileSize: configService.getOrThrow('s3Config.maxFileSize', { infer: true })
                    }
                };
            }
        }),
        I18nModule.forRootAsync({
            useFactory: (configService: ConfigService<AllConfigType>) => ({
                fallbackLanguage: configService.getOrThrow('appConfig.fallbackLanguage', {
                    infer: true
                }),
                loaderOptions: { path: path.join(__dirname, '../i18n/'), watch: true }
            }),
            resolvers: [
                {
                    use: HeaderResolver,
                    useFactory: (configService: ConfigService<AllConfigType>) => {
                        return [
                            configService.get('appConfig.headerLanguage', {
                                infer: true
                            })
                        ];
                    },
                    inject: [ConfigService]
                }
            ],
            imports: [ConfigModule],
            inject: [ConfigService]
        })
    ],
    providers: [
        IsNotUsedByOthers,
        IsNotExist,
        IsExist,
        IsDateGreaterThanNowValidator,
        EndLaterThanStartDateValidator,
        CompareDateConstraint,
        IsGreaterThanOrEqualConstraint,
        RequestIdMiddleware,
        SharedService,
        S3Client
    ],
    exports: [
        IsNotUsedByOthers,
        IsNotExist,
        IsExist,
        IsDateGreaterThanNowValidator,
        EndLaterThanStartDateValidator,
        CompareDateConstraint,
        IsGreaterThanOrEqualConstraint,
        RedisModule,
        S3Module,
        SqsMessagingModule,
        SnsModule,
        TracingModule,
        MonitoringModule,
        HttpClientsModule,
        LoggingModule,
        IdempotencyModule,
        RequestIdMiddleware,
        AuthModule,
        HelperModule,
        ClientsModule,
        MulterModule,
        SharedService
    ]
})
export class CommonModule {}
