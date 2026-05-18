# Technical Documentation

This comprehensive guide covers monitoring, metrics, messaging, and observability for the Referral Pulse Service.

## Table of Contents

1. [Environment Configuration](#environment-configuration)
2. [Kubernetes Deployment (Helm)](#kubernetes-deployment-helm)
3. [Grafana Cloud Integration](#grafana-cloud-integration)
4. [Application Metrics](#application-metrics)
5. [SQS Message Consumers](#sqs-message-consumers)
6. [Idempotent Message Handling](#idempotent-message-handling)

---

# Environment Configuration

The application uses environment-specific configuration files that are automatically loaded based on the `NODE_ENV` variable.

## Environment Files

- `.env.development` - Local development with LocalStack
- `.env.test` - Test environment
- `.env.staging` - Staging environment on AWS
- `.env.production` - Production environment on AWS (create as needed)
- `.env.example` - Template file (not loaded)

## How It Works

The application loads `.env.{NODE_ENV}` at startup:

```typescript
// src/app.module.ts
ConfigModule.forRoot({
  envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
})
```

**Examples:**
- `NODE_ENV=development` → loads `.env.development`
- `NODE_ENV=test` → loads `.env.test`
- `NODE_ENV=staging` → loads `.env.staging`
- No `NODE_ENV` set → defaults to `.env.development`

## Local Development Setup

1. Copy the appropriate template:
   ```bash
   cp .env.example .env.development
   ```

2. Update with your local values (LocalStack endpoints, credentials, etc.)

3. Run with development environment:
   ```bash
   NODE_ENV=development pnpm start:dev
   ```

## AWS Credentials

- **Local/Test**: Use access keys in `.env.development` and `.env.test`
- **Staging/Production**: Leave `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` empty - IAM roles attached to ECS/EC2/Lambda are used automatically

---

# Kubernetes Deployment (Helm)

The service can be deployed to Kubernetes using the Helm chart located in `deployment/helm/`.

## Features

- **IRSA (IAM Roles for Service Accounts)** - No AWS credentials in environment variables
- **Auto-scaling** - HPA based on CPU/memory with PDB for high availability
- **Network Policies** - Deny-all-ingress by default with explicit allow rules
- **Database Migrations** - Automatic pre-install/pre-upgrade migration job
- **Prometheus Metrics** - ServiceMonitor for automatic scraping
- **Health Probes** - Liveness and readiness checks

## Quick Deploy

### Staging

```bash
helm upgrade --install referral-svc ./deployment/helm \
  --namespace default \
  --values ./deployment/helm/values.yaml
```

### Production

```bash
helm upgrade --install referral-svc ./deployment/helm \
  --namespace production \
  --values ./deployment/helm/values-production.yaml
```

## Key Configuration

### 1. AWS Region (Default: eu-central-1)

All AWS services use `eu-central-1` by default:

```yaml
# values.yaml
envVars:
  AWS_REGION: "eu-central-1"
  AWS_S3_REGION: "eu-central-1"
```

### 2. SQS Queues (Individual Variables)

The Helm chart uses individual environment variables for each queue:

```yaml
SQS_QUEUE_CAMPAIGN_EVENTS: "https://sqs.eu-central-1.amazonaws.com/ACCOUNT/campaign-events.fifo"
SQS_QUEUE_REFERRAL_EVENTS: "https://sqs.eu-central-1.amazonaws.com/ACCOUNT/referral-events.fifo"
# ... 5 more queues
```

This matches the application configuration that extracts queues from `SQS_QUEUE_*` variables.

### 3. IRSA Configuration

The service account is annotated with the IAM role ARN:

```yaml
serviceAccount:
  irsa:
    enabled: true
    roleArn: arn:aws:iam::123456789012:role/referral-pulse-svc-role
```

**Important:** AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are **NOT** included in the Helm chart secrets. The application automatically uses IAM roles when running in staging/production.

### 4. JWT/Auth Configuration

```yaml
AUTH_JWKS_URI: "https://auth.example.com/.well-known/jwks.json"
AUTH_ISSUER: "https://auth.example.com/"
AUTH_AUDIENCE: "referral-pulse-api"
AUTH_TENANT_CLAIM_PATH: "tenantId"
```

## Environment Differences

| Configuration | Staging (values.yaml) | Production (values-production.yaml) |
|--------------|----------------------|-------------------------------------|
| Replicas | 3-20 | 5-50 |
| CPU/Memory | 200m/256Mi - 500m/512Mi | 500m/512Mi - 1000m/1024Mi |
| Database | RDS (SSL optional) | RDS (SSL required) |
| Redis | ElastiCache | ElastiCache (TLS required) |
| Queue URLs | `staging-*-events.fifo` | `prod-*-events.fifo` |
| OTEL Endpoint | Internal collector | Grafana Cloud |
| Logging Level | info | warn |

## Documentation

See [deployment/helm/README.md](./deployment/helm/README.md) for complete documentation including:
- IRSA setup guide
- Network policy customization
- Migration troubleshooting
- Monitoring and metrics
- CI/CD integration examples

---

# Grafana Cloud Integration

This section shows how to configure your NestJS application to export traces and metrics to Grafana Cloud.

## Overview

The application uses OpenTelemetry to export:
- **Traces** → Grafana Cloud Tempo
- **Metrics** → Grafana Cloud Mimir/Prometheus (optional)
- **Logs** → Can be exported to Loki via Pino (separate setup)

## Prerequisites

1. **Grafana Cloud Account**: Sign up at https://grafana.com/products/cloud/
2. **API Key**: Generate from your Grafana Cloud portal
3. **OTLP Endpoints**: Get from Grafana Cloud settings

## Configuration

### 1. Get Grafana Cloud Credentials

From your Grafana Cloud portal:

1. Go to **My Account** → **Security** → **API Keys**
2. Create a new API key with **MetricsPublisher** and **TracesPublisher** roles
3. Note your:
   - Instance ID (e.g., `123456`)
   - Zone (e.g., `prod-us-east-0`)
   - API Key token

### 2. Get OTLP Endpoints

Your Grafana Cloud OTLP endpoints will be:

**Traces (Tempo):**
```
https://otlp-gateway-{zone}.grafana.net/otlp/v1/traces
```

**Metrics (Prometheus/Mimir):**
```
https://otlp-gateway-{zone}.grafana.net/otlp/v1/metrics
```

Example for `prod-us-east-0`:
```
https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces
https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/metrics
```

### 3. Environment Variables

Add to your `.env` file:

```bash
# OpenTelemetry Configuration
OTEL_ENABLED=true
OTEL_SERVICE_NAME=referral-campaign-service
OTEL_SERVICE_VERSION=1.0.0
OTEL_SERVICE_NAMESPACE=production  # or staging, development

# Grafana Cloud Authentication
GRAFANA_CLOUD_USER=123456  # Your instance ID
GRAFANA_CLOUD_API_KEY=glc_eyJxxxxxxxxxxxxxx  # Your API key token

# Traces Endpoint (Tempo)
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces

# Metrics Endpoint (Prometheus/Mimir) - OPTIONAL
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/metrics

# Metrics Export Interval (milliseconds, default: 60000 = 1 minute)
OTEL_METRICS_EXPORT_INTERVAL=60000

# Trace Propagation
OTEL_PROPAGATE_B3=true
OTEL_PROPAGATE_W3C=true

# Log Level
OTEL_LOG_LEVEL=info
```

### 4. Docker Compose Example

```yaml
services:
  app:
    environment:
      # ... other env vars
      OTEL_ENABLED: "true"
      OTEL_SERVICE_NAME: "referral-campaign-service"
      OTEL_SERVICE_VERSION: "1.0.0"
      OTEL_SERVICE_NAMESPACE: "production"
      GRAFANA_CLOUD_USER: "${GRAFANA_CLOUD_USER}"
      GRAFANA_CLOUD_API_KEY: "${GRAFANA_CLOUD_API_KEY}"
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces"
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/metrics"
```

### 5. Kubernetes ConfigMap/Secret

**ConfigMap:**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-config
data:
  OTEL_ENABLED: "true"
  OTEL_SERVICE_NAME: "referral-campaign-service"
  OTEL_SERVICE_VERSION: "1.0.0"
  OTEL_SERVICE_NAMESPACE: "production"
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces"
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/metrics"
  OTEL_PROPAGATE_B3: "true"
  OTEL_PROPAGATE_W3C: "true"
```

**Secret:**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: grafana-cloud-credentials
type: Opaque
stringData:
  GRAFANA_CLOUD_USER: "123456"
  GRAFANA_CLOUD_API_KEY: "glc_eyJxxxxxxxxxxxxxx"
```

**Deployment:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: campaign-service
spec:
  template:
    spec:
      containers:
      - name: app
        envFrom:
        - configMapRef:
            name: otel-config
        - secretRef:
            name: grafana-cloud-credentials
```

## Verification

### 1. Check Application Logs

On startup, you should see:
```
[TracingService] Initializing OpenTelemetry for referral-campaign-service v1.0.0 (env: production)
[TracingService] Metrics export enabled to https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/metrics
[TracingService] OpenTelemetry SDK started - traces: https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces
```

### 2. Verify in Grafana Cloud

**Traces (Tempo):**
1. Go to **Explore** → Select **Tempo** datasource
2. Run a trace query or select **Search**
3. Filter by: `service.name = "referral-campaign-service"`
4. You should see traces appearing within 30 seconds

**Metrics (Prometheus):**
1. Go to **Explore** → Select **Prometheus** datasource
2. Query: `{service_name="referral-campaign-service"}`
3. Metrics should appear within 1-2 minutes (based on export interval)

### 3. Test Trace Generation

Make an API request to your service:
```bash
curl http://localhost:3000/api/v1/campaigns
```

Check Tempo for the trace with span name like:
- `GET /api/v1/campaigns`
- `http.get`
- `sqs.send`
- `database.query`

## What Gets Traced

### Automatic Instrumentation

The following are automatically traced:

1. **HTTP Requests** (Express)
   - Incoming requests to your API
   - Outgoing HTTP calls via HttpClientService

2. **Database Queries** (PostgreSQL)
   - All TypeORM queries
   - Connection pool metrics

3. **Redis Operations** (IORedis)
   - GET, SET, DEL, etc.
   - Lock acquire/release

4. **AWS SDK Calls**
   - SQS send/receive
   - SNS publish
   - S3 operations

### Custom Tracing

Use `TracingService.withSpan()` for custom operations:

```typescript
await this.tracingService.withSpan('campaign.process', async (span) => {
    span.setAttributes({
        'campaign.id': campaignId,
        'campaign.type': type,
    });

    await this.processCampaign(campaignId);
});
```

## Troubleshooting

### No Traces Appearing

1. **Check credentials**:
   ```bash
   echo $GRAFANA_CLOUD_USER
   echo $GRAFANA_CLOUD_API_KEY
   ```

2. **Verify endpoint**:
   ```bash
   curl -H "Authorization: Basic $(echo -n '${GRAFANA_CLOUD_USER}:${GRAFANA_CLOUD_API_KEY}' | base64)" \
        https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces
   ```

3. **Check application logs**:
   ```bash
   docker logs -f your-container | grep -i otel
   ```

4. **Test with basic auth**:
   The auth header should look like:
   ```
   Authorization: Basic MTIzNDU2OmdsY19leUo...
   ```

### Authentication Errors

If you see `401 Unauthorized`:
- Verify your API key has **TracesPublisher** role
- Check that GRAFANA_CLOUD_USER is your instance ID (numeric)
- Ensure API key is active and not expired

### High Cardinality Issues

If you see warnings about high cardinality:
- Reduce tenant IDs in trace attributes
- Use sampling for high-traffic endpoints
- Adjust `OTEL_SAMPLING_RATIO` (e.g., `0.1` for 10% sampling)

## Advanced Configuration

### Custom Sampling

Sample 10% of traces in production:
```bash
OTEL_SAMPLING_RATIO=0.1
```

### Disable Metrics (Traces Only)

```bash
# Just remove the metrics endpoint
unset OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
```

### Multi-Environment Setup

```bash
# Development - local
OTEL_ENABLED=false

# Staging - Grafana Cloud
OTEL_ENABLED=true
OTEL_SERVICE_NAMESPACE=staging
GRAFANA_CLOUD_USER=123456-staging
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://otlp-gateway-...

# Production - Grafana Cloud
OTEL_ENABLED=true
OTEL_SERVICE_NAMESPACE=production
GRAFANA_CLOUD_USER=123456-prod
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://otlp-gateway-...
```

## Cost Optimization

Grafana Cloud charges based on:
- Trace spans ingested
- Metrics data points stored

To reduce costs:

1. **Use sampling in production**:
   ```bash
   OTEL_SAMPLING_RATIO=0.1  # Sample 10% of traces
   ```

2. **Disable metrics if not needed**:
   ```bash
   # Don't set OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
   ```

3. **Filter out health checks**:
   Already configured in `HttpInstrumentation` to ignore `/health`, `/metrics`, etc.

4. **Set retention policies** in Grafana Cloud dashboard

## Next Steps

1. **Set up Grafana Dashboards**:
   - Use pre-built dashboards for NestJS/Node.js
   - Create custom dashboards for your business metrics

2. **Configure Alerts**:
   - High error rates
   - Slow response times
   - Circuit breakers opening

3. **Add Logs (Loki)**:
   - Configure Pino to export to Loki
   - Correlate logs with traces using trace IDs

4. **Performance Analysis**:
   - Identify slow database queries
   - Find N+1 query problems
   - Optimize HTTP client timeouts

## Resources

- Grafana Cloud Docs: https://grafana.com/docs/grafana-cloud/
- OpenTelemetry Docs: https://opentelemetry.io/docs/
- Tempo Docs: https://grafana.com/docs/tempo/

---

# Application Metrics

This section shows how to use the MetricsService to collect and export metrics to Grafana Cloud.

## Overview

The application provides a `MetricsService` that automatically collects common metrics and allows you to create custom metrics. All metrics are exported to Grafana Cloud Mimir/Prometheus via OpenTelemetry.

## Built-in Metrics

The following metrics are automatically collected when metrics are enabled:

### HTTP Metrics
- `http.requests.total` - Total number of HTTP requests (Counter)
  - Labels: `method`, `route`, `status_code`, `service`
- `http.request.duration` - HTTP request duration in ms (Histogram)
  - Labels: `method`, `route`, `status_code`, `service`
- `http.requests.active` - Number of active HTTP requests (Gauge)
  - Labels: `service`

### Database Metrics
- `db.queries.total` - Total number of database queries (Counter)
  - Labels: `operation`, `table`, `success`, `service`
- `db.query.duration` - Database query duration in ms (Histogram)
  - Labels: `operation`, `table`, `success`, `service`

### SQS Messaging Metrics
- `sqs.messages.produced` - Total messages sent to SQS (Counter)
  - Labels: `queue`, `event_type`, `success`, `service`
- `sqs.messages.consumed` - Total messages consumed from SQS (Counter)
  - Labels: `queue`, `event_type`, `success`, `service`
- `sqs.message.processing.duration` - Message processing duration in ms (Histogram)
  - Labels: `queue`, `event_type`, `service`

### SNS Metrics
- `sns.messages.published` - Total messages published to SNS (Counter)
  - Labels: `topic`, `event_type`, `success`, `service`

### Redis Metrics
- `redis.operations.total` - Total Redis operations (Counter)
  - Labels: `operation`, `success`, `service`
- `redis.operation.duration` - Redis operation duration in ms (Histogram)
  - Labels: `operation`, `success`, `service`

### Circuit Breaker Metrics
- `circuit_breaker.state` - Circuit breaker state (Gauge)
  - Values: 0=CLOSED, 1=HALF_OPEN, 2=OPEN
  - Labels: `service_name`

## Using Built-in Metrics

### HTTP Metrics (Automatic)

HTTP metrics are automatically recorded by the OpenTelemetry instrumentation. No code changes needed.

### Database Metrics

```typescript
import { Injectable } from '@nestjs/common';
import { MetricsService } from '@app/common/monitoring/metrics.service';

@Injectable()
export class CampaignService {
    constructor(private readonly metricsService: MetricsService) {}

    async findAll(): Promise<Campaign[]> {
        const startTime = Date.now();
        let success = true;

        try {
            const campaigns = await this.repository.find();
            return campaigns;
        } catch (error) {
            success = false;
            throw error;
        } finally {
            const duration = Date.now() - startTime;
            this.metricsService.recordDatabaseQuery('SELECT', 'campaigns', duration, success);
        }
    }
}
```

### SQS Metrics

Already integrated in `SqsProducerService` and `BaseSqsConsumer`. Metrics are automatically recorded when you use these services.

### SNS Metrics

Already integrated in `SnsPublisherService`.

### Redis Metrics

Already integrated in `RedisService`. Metrics are automatically recorded for GET, SET, DEL, and LOCK operations.

## Creating Custom Metrics

### Counter (for counting events)

```typescript
import { Injectable } from '@nestjs/common';
import { MetricsService } from '@app/common/monitoring/metrics.service';

@Injectable()
export class AuthService {
    private loginCounter;

    constructor(private readonly metricsService: MetricsService) {
        // Create the counter once
        this.loginCounter = this.metricsService.createCounter('user.logins.total', {
            description: 'Total number of user logins',
        });
    }

    async login(username: string, userType: string): Promise<void> {
        // ... login logic

        // Increment the counter
        this.loginCounter.add(1, {
            user_type: userType,
            success: 'true',
        });
    }
}
```

### Histogram (for measuring durations/sizes)

```typescript
import { Injectable } from '@nestjs/common';
import { MetricsService } from '@app/common/monitoring/metrics.service';

@Injectable()
export class OrderService {
    private processingTimeHistogram;

    constructor(private readonly metricsService: MetricsService) {
        this.processingTimeHistogram = this.metricsService.createHistogram('order.processing.duration', {
            description: 'Order processing duration in milliseconds',
            unit: 'ms',
        });
    }

    async processOrder(order: Order): Promise<void> {
        const startTime = Date.now();

        try {
            // ... process order
        } finally {
            const duration = Date.now() - startTime;
            this.processingTimeHistogram.record(duration, {
                order_type: order.type,
                payment_method: order.paymentMethod,
            });
        }
    }
}
```

### Gauge (for measuring current values)

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { MetricsService } from '@app/common/monitoring/metrics.service';

@Injectable()
export class ConnectionPoolService implements OnModuleInit {
    private activeConnections = 0;
    private connectionGauge;

    constructor(private readonly metricsService: MetricsService) {}

    onModuleInit() {
        this.connectionGauge = this.metricsService.createGauge('database.connections.active', {
            description: 'Number of active database connections',
        });

        // Gauge automatically observes the value at export intervals
        this.connectionGauge.addCallback((result) => {
            result.observe(this.activeConnections, {
                pool: 'main',
            });
        });
    }

    acquireConnection(): void {
        this.activeConnections++;
    }

    releaseConnection(): void {
        this.activeConnections--;
    }
}
```

## Advanced Usage

### Using the Raw Meter

For full OpenTelemetry capabilities:

```typescript
import { Injectable } from '@nestjs/common';
import { MetricsService } from '@app/common/monitoring/metrics.service';
import { ValueType } from '@opentelemetry/api';

@Injectable()
export class CustomMetricsService {
    constructor(private readonly metricsService: MetricsService) {}

    setupMetrics() {
        const meter = this.metricsService.getMeter();

        // Create a custom up-down counter
        const queueSize = meter.createUpDownCounter('queue.size', {
            description: 'Current size of the processing queue',
            valueType: ValueType.INT,
        });

        // Use it
        queueSize.add(1);  // Enqueue
        queueSize.add(-1); // Dequeue

        // Create an observable up-down counter
        const upDownCounter = meter.createObservableUpDownCounter('cache.size', {
            description: 'Current cache size in bytes',
        });

        upDownCounter.addCallback((result) => {
            const size = this.getCacheSize();
            result.observe(size);
        });
    }
}
```

## Querying Metrics in Grafana

### Example PromQL Queries

**HTTP Request Rate:**
```promql
rate(http_requests_total{service="referral-campaign-service"}[5m])
```

**HTTP Request Duration (95th percentile):**
```promql
histogram_quantile(0.95, rate(http_request_duration_bucket[5m]))
```

**SQS Message Processing Rate by Queue:**
```promql
rate(sqs_messages_consumed_total{service="referral-campaign-service"}[5m]) by (queue)
```

**Failed Database Queries:**
```promql
rate(db_queries_total{success="false"}[5m])
```

**Active HTTP Requests:**
```promql
http_requests_active{service="referral-campaign-service"}
```

**Circuit Breaker State:**
```promql
circuit_breaker_state{service_name="example.com"}
```

## Dashboard Example

Create a Grafana dashboard with these panels:

### Panel 1: HTTP Request Rate
```promql
sum(rate(http_requests_total[5m])) by (method, status_code)
```

### Panel 2: HTTP Response Time (p50, p95, p99)
```promql
histogram_quantile(0.50, rate(http_request_duration_bucket[5m]))
histogram_quantile(0.95, rate(http_request_duration_bucket[5m]))
histogram_quantile(0.99, rate(http_request_duration_bucket[5m]))
```

### Panel 3: Database Query Performance
```promql
rate(db_queries_total[5m]) by (operation, table)
```

### Panel 4: SQS Message Throughput
```promql
sum(rate(sqs_messages_produced_total[5m])) by (queue)
sum(rate(sqs_messages_consumed_total[5m])) by (queue)
```

### Panel 5: Error Rate
```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
```

## Best Practices

### 1. Use Meaningful Labels
```typescript
// ❌ Bad - too generic
counter.add(1, { type: 'A' });

// ✅ Good - descriptive
counter.add(1, { payment_method: 'credit_card', region: 'us-east-1' });
```

### 2. Avoid High Cardinality
```typescript
// ❌ Bad - userId creates millions of unique label combinations
counter.add(1, { user_id: userId }); // DON'T DO THIS

// ✅ Good - use aggregated labels
counter.add(1, { user_type: 'premium' });
```

### 3. Keep Label Values Consistent
```typescript
// ❌ Bad - inconsistent values
counter.add(1, { status: 'Success' });
counter.add(1, { status: 'success' });
counter.add(1, { status: '200' });

// ✅ Good - consistent values
counter.add(1, { status: 'success' });
counter.add(1, { status: 'success' });
counter.add(1, { status: 'success' });
```

### 4. Reuse Metric Instances
```typescript
// ❌ Bad - creates new metric every time
increment() {
    const counter = this.metricsService.createCounter('clicks');
    counter.add(1);
}

// ✅ Good - create once, use many times
private clickCounter;

constructor(metricsService: MetricsService) {
    this.clickCounter = metricsService.createCounter('clicks');
}

increment() {
    this.clickCounter.add(1);
}
```

### 5. Use Descriptive Names
```typescript
// ❌ Bad
this.metricsService.createCounter('count');

// ✅ Good
this.metricsService.createCounter('campaign.activations.total', {
    description: 'Total number of campaign activations',
});
```

## Troubleshooting

### Metrics Not Appearing

1. **Check metrics endpoint is configured:**
   ```bash
   echo $OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
   ```

2. **Verify metrics export interval:**
   Default is 60 seconds. Metrics won't appear immediately.

3. **Check application logs:**
   ```
   [MetricsService] Initializing metrics...
   [MetricsService] Metrics initialized successfully
   [TracingService] Metrics export enabled to https://...
   ```

### High Cardinality Warning

If you see warnings in Grafana about high cardinality:
- Remove labels with many unique values (user IDs, timestamps, etc.)
- Use aggregated labels instead (user type, hour of day, etc.)
- Consider sampling for high-frequency metrics

### Memory Issues

If metrics are consuming too much memory:
- Reduce the number of unique label combinations
- Increase export interval (less frequent exports)
- Remove unused metrics

---

# SQS Message Consumers

This section shows how to create SQS message consumers using the simplified `@SqsConsumer` decorator which integrates `@ssut/nestjs-sqs` with automatic envelope parsing, tenant context setup, idempotency checking, and metrics recording.

## Quick Start

### 1. Basic Consumer with @SqsConsumer Decorator

```typescript
import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { SqsConsumer } from '@app/common/messaging';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import type { IMessageEnvelope } from '@app/types';

interface CampaignCreatedPayload {
    campaignId: string;
    name: string;
    tenantId: string;
}

@Injectable()
export class CampaignEventsConsumer {
    constructor(
        private readonly tenantContext: ClsTenantContextService,
        private readonly logger: AppLoggerService,
        private readonly campaignService: CampaignService,
    ) {}

    /**
     * Handle campaign.created events
     *
     * The @SqsConsumer decorator automatically:
     * - Parses the message envelope
     * - Sets up tenant context (tenantId, correlationId, traceId, etc.)
     * - Checks for duplicate messages (idempotency)
     * - Records metrics
     *
     * The parsed envelope is available via: this.tenantContext.get<IMessageEnvelope>('envelope')
     */
    @SqsConsumer({ queueName: 'campaign-events', eventType: 'campaign.created' })
    async handleCampaignCreated(message: Message) {
        // Get the parsed envelope from context
        const envelope = this.tenantContext.get<IMessageEnvelope<CampaignCreatedPayload>>('envelope');

        // Process the payload - idempotency already handled by interceptor
        this.logger.log(`Creating campaign: ${envelope.payload.name}`);
        await this.campaignService.create(envelope.payload);
    }
}
```

### 2. Multi-Event Consumer

Handle multiple event types in one consumer class:

```typescript
@Injectable()
export class ReferralEventsConsumer extends BaseSqsConsumer {
    constructor(
        idempotencyService: IdempotencyService,
        envelopeService: MessageEnvelopeService,
        metricsService: MetricsService,
        logger: AppLoggerService,
        private readonly referralService: ReferralService,
    ) {
        super(idempotencyService, envelopeService, metricsService, logger);
    }

    @SqsConsumer({ queueName: 'referral-events' })
    async handleMessage(message: Message) {
        const envelope = this.parseMessage(message);

        // Route by event type
        switch (envelope.eventType) {
            case 'referral.created':
                await this.handleReferralCreated(message);
                break;
            case 'referral.completed':
                await this.handleReferralCompleted(message);
                break;
            default:
                this.logger.warn(`Unknown event type: ${envelope.eventType}`);
        }
    }

    private async handleReferralCreated(message: Message) {
        await this.processWithTenantContext<ReferralCreatedPayload>(
            message,
            async (payload, envelope) => {
                await this.referralService.create(payload);
            },
            { queueName: 'referral-events' },
        );
    }

    private async handleReferralCompleted(message: Message) {
        await this.processWithTenantContext<ReferralCompletedPayload>(
            message,
            async (payload, envelope) => {
                await this.referralService.markCompleted(payload.referralId);
            },
            { queueName: 'referral-events' },
        );
    }

    @SqsEventHandler('referral-events', 'processing_error')
    onError(error: Error, message: Message) {
        this.handleProcessingError(error, message);
    }
}
```

### 3. Batch Processing Consumer

Process multiple messages at once:

```typescript
@Injectable()
export class BatchEventsConsumer extends BaseSqsConsumer {
    constructor(
        idempotencyService: IdempotencyService,
        envelopeService: MessageEnvelopeService,
        metricsService: MetricsService,
        logger: AppLoggerService,
        private readonly analyticsService: AnalyticsService,
    ) {
        super(idempotencyService, envelopeService, metricsService, logger);
    }

    /**
     * Process messages in batches
     * Set batch: true to receive Message[] instead of Message
     */
    @SqsConsumer({ queueName: 'analytics-events', batch: true })
    async handleBatch(messages: Message[]) {
        this.logger.log(`Processing batch of ${messages.length} analytics events`);

        await this.processBatchWithIdempotency<AnalyticsPayload>(
            messages,
            async (envelope) => {
                await this.analyticsService.track(envelope.payload);
            },
            { queueName: 'analytics-events' },
        );
    }

    @SqsEventHandler('analytics-events', 'processing_error')
    onError(error: Error, message: Message) {
        // For batch consumers, this is called for each failed message
        this.handleProcessingError(error, message);
    }
}
```

### 4. Consumer Without Idempotency

For use cases where idempotency isn't needed (e.g., already handled upstream):

```typescript
@Injectable()
export class NotificationConsumer extends BaseSqsConsumer {
    constructor(
        idempotencyService: IdempotencyService,
        envelopeService: MessageEnvelopeService,
        metricsService: MetricsService,
        logger: AppLoggerService,
        private readonly emailService: EmailService,
    ) {
        super(idempotencyService, envelopeService, metricsService, logger);
    }

    @SqsConsumer({ queueName: 'notifications' })
    async handleNotification(message: Message) {
        // Skip idempotency check - emails have their own dedup logic
        await this.processWithTenantContext<NotificationPayload>(
            message,
            async (payload, envelope) => {
                await this.emailService.send(payload);
            },
            { skipIdempotency: true, queueName: 'notifications' },
        );
    }
}
```

### 5. Advanced: Manual Message Parsing and Custom Logic

```typescript
@Injectable()
export class CustomConsumer extends BaseSqsConsumer {
    constructor(
        idempotencyService: IdempotencyService,
        envelopeService: MessageEnvelopeService,
        metricsService: MetricsService,
        logger: AppLoggerService,
    ) {
        super(idempotencyService, envelopeService, metricsService, logger);
    }

    @SqsConsumer({ queueName: 'custom-queue' })
    async handleMessage(message: Message) {
        // Parse message manually
        const envelope = this.parseMessage<CustomPayload>(message);

        // Custom validation
        if (!envelope.payload.isValid) {
            this.logger.warn(`Invalid payload in message ${envelope.messageId}`);
            return; // Message will be deleted (not re-queued)
        }

        // Filter by event type
        const filtered = this.filterByEventType<CustomPayload>(message, 'custom.event');
        if (!filtered) return;

        // Custom idempotency key
        const customKey = `custom:${envelope.payload.entityId}:${envelope.payload.action}`;

        // Use manual idempotency
        const isDupe = await this.idempotencyService.isDuplicate(customKey);
        if (isDupe) {
            this.logger.log(`Duplicate detected: ${customKey}`);
            return;
        }

        try {
            await this.processCustomEvent(envelope.payload);
            await this.idempotencyService.markProcessed(customKey);
        } catch (error) {
            this.logger.error(`Processing failed: ${(error as Error).message}`);
            throw error; // Re-throw to trigger SQS retry
        }
    }

    private async processCustomEvent(payload: CustomPayload) {
        // Your custom processing logic
    }

    @SqsEventHandler('custom-queue', 'processing_error')
    onError(error: Error, message: Message) {
        this.handleProcessingError(error, message);
    }

    @SqsEventHandler('custom-queue', 'timeout_error')
    onTimeout(error: Error, message: Message) {
        this.logger.error(`Message processing timed out: ${message.MessageId}`);
    }
}
```

## Registering Consumers

Add your consumer to the module's providers:

```typescript
import { Module } from '@nestjs/common';
import { CampaignEventsConsumer } from './campaign-events.consumer';
import { ReferralEventsConsumer } from './referral-events.consumer';
import { MessagingModule } from '@app/common/messaging';

@Module({
    imports: [MessagingModule.forRoot()],
    providers: [
        CampaignEventsConsumer,
        ReferralEventsConsumer,
        // ... other consumers
    ],
})
export class YourModule {}
```

## Testing Consumers

```typescript
import { Test } from '@nestjs/testing';
import { Message } from '@aws-sdk/client-sqs';
import { CampaignEventsConsumer } from './campaign-events.consumer';
import { IdempotencyService } from '@app/common/messaging';

describe('CampaignEventsConsumer', () => {
    let consumer: CampaignEventsConsumer;
    let idempotencyService: IdempotencyService;

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            providers: [
                CampaignEventsConsumer,
                {
                    provide: IdempotencyService,
                    useValue: {
                        executeOnce: jest.fn((key, fn) => fn().then(() => ({ isDuplicate: false }))),
                    },
                },
                // ... other mocks
            ],
        }).compile();

        consumer = module.get(CampaignEventsConsumer);
        idempotencyService = module.get(IdempotencyService);
    });

    it('should process campaign.created event', async () => {
        const message: Message = {
            MessageId: 'test-123',
            Body: JSON.stringify({
                messageId: 'msg-123',
                eventType: 'campaign.created',
                payload: { campaignId: '1', name: 'Test Campaign', tenantId: 'tenant-1' },
                tenantId: 'tenant-1',
                correlationId: 'corr-123',
                timestamp: new Date().toISOString(),
            }),
        };

        await consumer.handleCampaignCreated(message);

        expect(idempotencyService.executeOnce).toHaveBeenCalledWith(
            'msg-123',
            expect.any(Function),
            undefined,
        );
    });

    it('should handle duplicate messages', async () => {
        jest.spyOn(idempotencyService, 'executeOnce').mockResolvedValue({
            result: true,
            isDuplicate: true,
        });

        const message: Message = {
            MessageId: 'test-123',
            Body: JSON.stringify({
                messageId: 'msg-123',
                eventType: 'campaign.created',
                payload: { campaignId: '1', name: 'Test', tenantId: 'tenant-1' },
            }),
        };

        await consumer.handleCampaignCreated(message);

        // Verify no actual processing happened (checked via spy on service methods)
    });
});
```

## Key Concepts

### Message Flow
1. **SQS receives message** → Queue configured in `MessagingModule.forRoot()`
2. **@ssut/nestjs-sqs polls** → Automatic long-polling based on config
3. **@SqsConsumer decorator triggers** → Your handler method is called
4. **processWithTenantContext** → Sets tenant context, checks idempotency, processes once, marks complete
5. **Metrics recorded** → SQS consumption and processing duration metrics
6. **Success** → Message deleted from queue
7. **Failure** → Message retried (visibility timeout) or moved to DLQ

### Error Handling
- **Transient errors**: Throw error → SQS retries (visibility timeout)
- **Permanent errors**: Don't throw → Message deleted (logged as warning)
- **Max retries exceeded**: Message moved to DLQ automatically
- **Use DlqConsumerService**: Inspect/reprocess DLQ messages

### Best Practices
1. Always extend `BaseSqsConsumer` for consistent behavior
2. Use `processWithTenantContext` for tenant-aware messages
3. Always pass `queueName` option to enable proper metrics recording
4. Set appropriate visibility timeouts (longer than processing time)
5. Configure DLQ with appropriate retention (7-14 days)
6. Monitor DLQ size and set up alerts
7. Use batch processing for high-throughput scenarios
8. Keep payload types strongly typed with interfaces

### Configuration

Queue configuration in `.env`:
```bash
# SQS Configuration
AWS_SQS_QUEUES='[{"name":"campaign-events","url":"https://sqs.us-east-1.amazonaws.com/123/campaign-events"},{"name":"campaign-events-dlq","url":"https://sqs.us-east-1.amazonaws.com/123/campaign-events-dlq"}]'
AWS_SQS_DEFAULT_BATCH_SIZE=10
AWS_SQS_DEFAULT_VISIBILITY_TIMEOUT=30
AWS_SQS_DEFAULT_WAIT_TIME_SECONDS=20
AWS_SQS_POLLING_ENABLED=true
```

Redrive policy (set on main queue via AWS Console/Terraform):
```json
{
  "deadLetterTargetArn": "arn:aws:sqs:us-east-1:123:campaign-events-dlq",
  "maxReceiveCount": 3
}
```

---

# Idempotent Message Handling

This section shows how to use the idempotency features to ensure messages are processed exactly once.

## Option 1: Using the `@Idempotent()` Decorator

Best for simple handlers where you want fine-grained control over idempotency per method.

```typescript
import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import { Idempotent, IdempotencyService } from '@app/common/messaging';
import type { IMessageEnvelope } from '@app/types';

@Injectable()
export class CampaignConsumer {
    constructor(private readonly idempotencyService: IdempotencyService) {}

    @SqsMessageHandler('campaign-queue', false)
    @Idempotent({ ttl: 3600 }) // Optional: customize TTL
    async handleCampaignCreated(message: IMessageEnvelope<CampaignCreatedPayload>) {
        // This code will only execute once per unique message
        console.log('Processing campaign:', message.payload);
        await this.campaignService.create(message.payload);
    }

    @SqsMessageHandler('campaign-queue', false)
    @Idempotent({
        ttl: 7200,
        keyExtractor: (msg) => `campaign-update-${msg.payload.campaignId}`, // Custom key
    })
    async handleCampaignUpdated(message: IMessageEnvelope<CampaignUpdatedPayload>) {
        await this.campaignService.update(message.payload);
    }
}
```

## Option 2: Using `BaseMessageHandler` Class

Best for complex handlers with shared logic, error handling, and lifecycle hooks.

```typescript
import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import { BaseMessageHandler, IdempotencyService } from '@app/common/messaging';
import type { IMessageEnvelope } from '@app/types';

interface CampaignCreatedPayload {
    campaignId: string;
    name: string;
    tenantId: string;
}

@Injectable()
export class CampaignCreatedHandler extends BaseMessageHandler<CampaignCreatedPayload> {
    readonly eventType = 'campaign.created';

    constructor(
        idempotencyService: IdempotencyService,
        logger: AppLoggerService,
        private readonly campaignService: CampaignService,
        private readonly notificationService: NotificationService,
    ) {
        super(idempotencyService, logger);
    }

    // Optional: Customize idempotency TTL (default: 24 hours)
    protected getIdempotencyTtl(): number {
        return 3600; // 1 hour
    }

    // Optional: Custom idempotency key
    protected getIdempotencyKey(message: IMessageEnvelope<CampaignCreatedPayload>): string {
        return `campaign-created-${message.payload.campaignId}`;
    }

    // Required: Implement your processing logic
    protected async process(message: IMessageEnvelope<CampaignCreatedPayload>): Promise<void> {
        const { campaignId, name, tenantId } = message.payload;

        await this.campaignService.create({
            id: campaignId,
            name,
            tenantId,
        });

        await this.notificationService.notify(tenantId, `Campaign ${name} created`);
    }

    // Optional: Custom error handling
    protected async onError(error: Error, message: IMessageEnvelope<CampaignCreatedPayload>): Promise<void> {
        this.logger.error(`Failed to create campaign ${message.payload.campaignId}:`, error);

        // Send to DLQ or alert monitoring
        await this.notificationService.alertOps('Campaign creation failed', error);

        throw error; // Re-throw to trigger SQS retry
    }

    // Optional: Post-success actions
    protected async onSuccess(message: IMessageEnvelope<CampaignCreatedPayload>): Promise<void> {
        this.logger.log(`Campaign ${message.payload.campaignId} created successfully`);
    }

    // Optional: Handle duplicate detection
    protected async onDuplicate(message: IMessageEnvelope<CampaignCreatedPayload>): Promise<void> {
        this.logger.log(`Campaign ${message.payload.campaignId} already created, skipping`);
    }
}

// Register the handler in your consumer
@Injectable()
export class CampaignEventsConsumer {
    constructor(private readonly campaignCreatedHandler: CampaignCreatedHandler) {}

    @SqsMessageHandler('campaign-events-queue', false)
    async handleMessage(message: IMessageEnvelope<unknown>) {
        if (message.eventType === 'campaign.created') {
            await this.campaignCreatedHandler.handle(message as IMessageEnvelope<CampaignCreatedPayload>);
        }
    }
}
```

## Option 3: Manual Idempotency Service Usage

For cases where you need direct control over idempotency logic.

```typescript
import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import { IdempotencyService } from '@app/common/messaging';
import type { IMessageEnvelope } from '@app/types';

@Injectable()
export class ManualConsumer {
    constructor(private readonly idempotencyService: IdempotencyService) {}

    @SqsMessageHandler('my-queue', false)
    async handleMessage(message: IMessageEnvelope<MyPayload>) {
        // Option A: Early return if duplicate
        if (await this.idempotencyService.isDuplicate(message.messageId)) {
            console.log('Duplicate message, skipping');
            return;
        }

        try {
            await this.processMessage(message);
            await this.idempotencyService.markProcessed(message.messageId);
        } catch (error) {
            // Don't mark as processed if it fails
            throw error;
        }
    }

    @SqsMessageHandler('another-queue', false)
    async handleAnotherMessage(message: IMessageEnvelope<AnotherPayload>) {
        // Option B: Use executeOnce for atomic processing
        const { result, isDuplicate } = await this.idempotencyService.executeOnce(
            message.messageId,
            async () => {
                return this.processAnotherMessage(message);
            },
            7200, // Custom TTL: 2 hours
        );

        if (isDuplicate) {
            console.log('Already processed, returning cached result:', result);
        }

        return result;
    }

    private async processMessage(message: IMessageEnvelope<MyPayload>): Promise<void> {
        // Your processing logic
    }

    private async processAnotherMessage(message: IMessageEnvelope<AnotherPayload>): Promise<string> {
        // Your processing logic that returns a result
        return 'processed';
    }
}
```

## Key Concepts

### Idempotency Key
- **Default**: Uses `message.idempotencyKey` or falls back to `message.messageId`
- **Custom**: Override `getIdempotencyKey()` or use `keyExtractor` option
- **TTL**: Defaults to 24 hours, configurable per handler

### How It Works
1. Before processing, checks Redis for the idempotency key
2. If found → returns cached result (duplicate detected)
3. If not found → acquires a lock, processes message, stores result
4. Lock prevents race conditions when same message arrives multiple times

### When to Use Each Approach

- **`@Idempotent()` decorator**: Simple handlers, minimal boilerplate
- **`BaseMessageHandler`**: Complex handlers, shared error handling, lifecycle hooks
- **Manual service**: Fine-grained control, non-standard workflows
- **`BaseSqsConsumer`** (Recommended): Best for tenant-aware messages with automatic tenant context

### Best Practices

1. Always include `IdempotencyService` in your consumer constructor
2. Use meaningful idempotency keys (e.g., include entity IDs)
3. Set appropriate TTLs based on your use case
4. Handle duplicates gracefully (log but don't fail)
5. Don't mark messages as processed if they fail

## Testing Idempotency

```typescript
describe('CampaignCreatedHandler', () => {
    let handler: CampaignCreatedHandler;
    let idempotencyService: IdempotencyService;

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            providers: [
                CampaignCreatedHandler,
                { provide: IdempotencyService, useValue: mockIdempotencyService },
            ],
        }).compile();

        handler = module.get(CampaignCreatedHandler);
        idempotencyService = module.get(IdempotencyService);
    });

    it('should process message only once', async () => {
        const message = createMockMessage({ campaignId: '123' });

        // First call - should process
        await handler.handle(message);
        expect(campaignService.create).toHaveBeenCalledTimes(1);

        // Second call - should skip (duplicate)
        await handler.handle(message);
        expect(campaignService.create).toHaveBeenCalledTimes(1); // Still 1!
    });
});
```

---

## Summary

This technical documentation covers:

1. **Grafana Cloud Integration** - Complete setup for traces and metrics export
2. **Application Metrics** - Built-in and custom metrics collection
3. **SQS Message Consumers** - Patterns for reliable message processing with automatic tenant context and metrics
4. **Idempotent Message Handling** - Ensure exactly-once message processing

All components work together to provide:
- Comprehensive observability via Grafana Cloud
- Reliable message processing with idempotency guarantees
- Automatic tenant context propagation
- Detailed metrics for monitoring and alerting
- Production-ready patterns following Clean Architecture and SOLID principles
