import { Global, Module } from '@nestjs/common';
import { HttpModule as NestHttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { AllConfigType } from '@app/config/config.type';
import { HttpClientService } from './http-client.service';
import { HttpOutboundInterceptor } from './http-outbound.interceptor';

@Global()
@Module({
    imports: [
        NestHttpModule.registerAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService<AllConfigType>) => ({
                timeout: configService.getOrThrow('http.timeout', { infer: true }),
                maxRedirects: configService.getOrThrow('http.maxRedirects', { infer: true }),
            }),
        }),
    ],
    providers: [HttpClientService, HttpOutboundInterceptor],
    exports: [HttpClientService, NestHttpModule],
})
export class HttpModule {}

export { HttpClientService };
