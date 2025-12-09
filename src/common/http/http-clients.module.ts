import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import httpClientConfig from '@mod/config/http-client.config';
import cacheConfig from '@mod/config/cache.config';
import { CircuitBreakerFactory } from './circuit-breaker.factory';
import { HelperModule } from '@mod/common/helpers/helper.module';
import { MachineAuthProvider } from './machine-auth.provider';
import { HttpClient } from '@mod/common/http/http.client';

@Module({})
export class HttpClientsModule {
    static register(): DynamicModule {
        return {
            module: HttpClientsModule,
            imports: [
                ConfigModule.forFeature(httpClientConfig),
                ConfigModule.forFeature(cacheConfig),
                HttpModule.registerAsync({
                    imports: [ConfigModule.forFeature(httpClientConfig)],
                    inject: [ConfigService],
                    useFactory: (cfg: ConfigService) => ({
                        timeout: cfg.getOrThrow<number>('httpClientConfig.intra.timeoutMs', { infer: true }),
                        maxRedirects: 5,
                    }),
                }),
                HelperModule,
            ],
            providers: [
                CircuitBreakerFactory,
                MachineAuthProvider,
                HttpClient,
            ],
            exports: [HttpClient],
        };
    }
}
