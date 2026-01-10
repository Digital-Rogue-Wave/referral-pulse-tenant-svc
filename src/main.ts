import { ClassSerializerInterceptor, Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import { AppModule } from './app.module';
import { AllConfigType } from './config/config.type';
import validationOptions from '@mod/common/validators/validation-options';
import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';
import cors from 'cors';
import { initializeTransactionalContext, StorageDriver } from 'typeorm-transactional';

async function bootstrap() {
    initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });
    const app = await NestFactory.create(AppModule, {
        cors: true,
        abortOnError: true,
        bufferLogs: true,
        rawBody: true
    });
    const configService = app.get(ConfigService<AllConfigType>);
    useContainer(app.select(AppModule), {
        fallbackOnErrors: true // fallbackOnErrors must be true
    });

    app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
    app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));
    app.use(hpp());
    app.use(compression());

    app.useLogger(app.get(Logger));

    app.enableShutdownHooks();
    app.setGlobalPrefix(configService.getOrThrow('appConfig.apiPrefix', { infer: true }), {
        exclude: ['/', '/live', '/ready', '/startup', '/success', '/cancel']
    });
    app.enableVersioning({
        type: VersioningType.URI
    });
    app.useGlobalPipes(new ValidationPipe(validationOptions));
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

    const options = new DocumentBuilder()
        .setTitle('Referral Pulse Campaign API')
        .setDescription('API List fro campaign microservice')
        .setVersion('1.0')
        .addBearerAuth()
        .addGlobalParameters({
            name: configService.getOrThrow('appConfig.headerLanguage', { infer: true }),
            required: true,
            in: 'header'
        })
        .build();

    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('tenant-docs', app, document);
    /*app.use(
        '/tenant-docs',
        apiReference({
            spec: {
                content: document
            },
            favicon: 'https://cdn.prod.website-files.com/6600622e5ed775a33bff8280/6601af87c424b81fa4e5c8c1_DIGITAL%20ROGUE%20WAVE.svg'
        })
    );*/

    await app.listen(configService.getOrThrow('appConfig.port', { infer: true }), () => {
        Logger.log(
            `${configService.getOrThrow('appConfig.name', {
                infer: true
            })} Server is listening to port ${configService.getOrThrow('appConfig.port', {
                infer: true
            })}...`
        );
    });
}

void bootstrap().catch((e) => {
    Logger.error(`❌  Error starting server, ${e}`, '', 'Bootstrap');
    throw e;
});
