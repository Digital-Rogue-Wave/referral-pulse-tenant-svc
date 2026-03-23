import { Global, Module } from '@nestjs/common';

import { HttpMetricsService } from './http-metrics.service';
import { MessagingMetricsService } from './messaging-metrics.service';
import { MetricsService } from './metrics.service';
import { TracingService } from './tracing.service';

@Global()
@Module({
    providers: [TracingService, MetricsService, MessagingMetricsService, HttpMetricsService],
    exports: [TracingService, MetricsService, MessagingMetricsService, HttpMetricsService],
})
export class TracingModule {}
