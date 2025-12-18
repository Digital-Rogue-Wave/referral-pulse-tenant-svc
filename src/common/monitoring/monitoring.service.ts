import { Inject, Injectable, Optional } from '@nestjs/common';
import { Counter, Histogram } from 'prom-client';

type CounterName =
    | 'ingestion_valid_total'
    | 'ingestion_invalid_total'
    | 'ingestion_duplicate_total'
    | 'ingestion_rejected_bytes_total'
    | 'sqs_messages_processed_total'
    | 'billing_subscription_events_total';

@Injectable()
export class MonitoringService {
    private readonly counters: Partial<Record<CounterName, Counter<string>>>;

    constructor(
        @Inject('PrometheusHistogram_http_server_duration_seconds')
        private readonly httpServerDuration: Histogram<string>,

        @Inject('PrometheusHistogram_http_client_duration_seconds')
        private readonly httpClientDuration: Histogram<string>,

        @Inject('PrometheusHistogram_sqs_handler_duration_seconds')
        private readonly sqsHandlerDuration: Histogram<string>,

        // --- Optional counters (inject only if you registered them) ---
        @Optional()
        @Inject('PrometheusCounter_sqs_messages_processed_total')
        private readonly sqsProcessed?: Counter<string>,

        @Optional()
        @Inject('PrometheusCounter_ingestion_valid_total')
        private readonly ingestionValid?: Counter<string>,

        @Optional()
        @Inject('PrometheusCounter_ingestion_invalid_total')
        private readonly ingestionInvalid?: Counter<string>,

        @Optional()
        @Inject('PrometheusCounter_ingestion_duplicate_total')
        private readonly ingestionDuplicate?: Counter<string>,

        @Optional()
        @Inject('PrometheusCounter_ingestion_rejected_bytes_total')
        private readonly ingestionRejectedBytes?: Counter<string>,

        @Optional()
        @Inject('PrometheusCounter_billing_subscription_events_total')
        private readonly billingSubscriptionEvents?: Counter<string>
    ) {
        this.counters = {
            sqs_messages_processed_total: this.sqsProcessed,
            ingestion_valid_total: this.ingestionValid,
            ingestion_invalid_total: this.ingestionInvalid,
            ingestion_duplicate_total: this.ingestionDuplicate,
            ingestion_rejected_bytes_total: this.ingestionRejectedBytes,
            billing_subscription_events_total: this.billingSubscriptionEvents
        };
    }

    // ---------- Generic helpers ----------

    /**
     * Increment a named counter safely.
     * If the counter isn’t bound in DI, this is a no-op.
     */
    incCounter(name: CounterName, labels?: Record<string, string>, value = 1): void {
        const counter = this.counters[name];
        if (!counter) return;

        if (labels && Object.keys(labels).length) {
            counter.labels(labels).inc(value);
        } else {
            counter.inc(value);
        }
    }

    // ---------- HTTP server/client histograms ----------

    observeHttpServer(method: string, route: string, status: number, seconds: number): void {
        this.httpServerDuration.labels(method, route, String(status)).observe(seconds);
    }

    observeHttpClient(kind: 'intra' | 'thirdparty', method: string, target: string, status: number, seconds: number): void {
        this.httpClientDuration.labels(method, target, String(status), kind).observe(seconds);
    }

    // ---------- SQS helpers (backed by histogram + counter) ----------

    observeSqsHandler(queue: string, result: 'ok' | 'error', seconds: number): void {
        this.sqsHandlerDuration.labels(queue, result).observe(seconds);
        this.incCounter('sqs_messages_processed_total', { queue, result });
    }
}
