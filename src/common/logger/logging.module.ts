import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpLoggingInterceptor } from '@mod/common/logger/http-logging.interceptor';
import { HelperModule } from '@mod/common/helpers/helper.module';
import { RpcLoggingInterceptor } from '@mod/common/logger/rpc-logging.interceptor';
import { AppLoggingService } from '@mod/common/logger/app-logging.service';
import { OutboundLoggingService } from '@mod/common/logger/outbound-logging.service';
import { EventLoggingService } from '@mod/common/logger/event-logging.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import loggerConfig from '@mod/config/logger.config';

/**
 * Global logging module exposing:
 *  - AppLogger: for service/business logs
 *  - HttpLoggingInterceptor: for inbound HTTP logs
 *  - EventCommLogger: helper for events
 *
 * In prod, logs are structured JSON to stdout (for Loki/S3 stack ingestion).
 * In local, logs are pretty-printed via pino-pretty.
 */
@Global()
@Module({
    imports: [ConfigModule.forFeature(loggerConfig), HelperModule],
    providers: [
        AppLoggingService,
        OutboundLoggingService,
        EventLoggingService,
        { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
        { provide: APP_INTERCEPTOR, useClass: RpcLoggingInterceptor },
        { provide: Logger, useExisting: AppLoggingService }
    ],
    exports: [Logger, AppLoggingService, OutboundLoggingService, EventLoggingService]
})
export class LoggingModule {}

/*

@SqsProcess('orders')
@Injectable()
export class OrdersConsumer {
  constructor(public readonly logger: AppLoggerService, public readonly cls: ClsService<ClsRequestContext>) {}

  @SqsLogged('orders', false)
  @SqsMessageHandler(false)
  async handle(message: Message): Promise<void> {
    // ...
  }
}


 */
