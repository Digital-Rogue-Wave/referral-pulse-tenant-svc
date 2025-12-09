import { Injectable } from '@nestjs/common';
import { context, trace } from '@opentelemetry/api';

@Injectable()
export class TraceContextService {
    getTraceIds(): { traceId?: string; spanId?: string } {
        const span = trace.getSpan(context.active());
        const spanCtx = span?.spanContext();
        return { traceId: spanCtx?.traceId, spanId: spanCtx?.spanId };
    }
}
