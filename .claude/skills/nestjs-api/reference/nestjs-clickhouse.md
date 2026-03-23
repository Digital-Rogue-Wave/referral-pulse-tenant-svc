# ClickHouse Analytics Patterns in NestJS

ClickHouse-specific patterns for high-performance analytics and data engineering, integrated within the NestJS framework.

## When to Activate

- Designing ClickHouse table schemas (MergeTree engine selection)
- Writing analytical queries (aggregations, window functions, joins)
- Implementing the `ClickHouseService` for data ingestion
- Optimizing query performance (partition pruning, projections, materialized views)
- Ingesting large volumes of data via NestJS services
- Migrating from PostgreSQL/MySQL to ClickHouse for analytics

## Overview

In this microservice, ClickHouse is managed via a dedicated `ClickHouseService` that wraps the official `@clickhouse/client`. This ensures consistent configuration, logging, and lifecycle management.

**Key Features:**

- **Lifecycle Managed**: Automatically connects `onModuleInit` and disconnects `onModuleDestroy`.
- **Type-Safe Config**: Uses `ConfigService<AllConfigType>` for validated environment configuration.
- **Unified Logging**: Integrates with `AppLoggerService` for tracking query performance and failures.

## NestJS Integration Pattern

The `ClickHouseService` should be used for all database interactions. It is located in `@common/storage/clickhouse.service`.

### Service Usage Example

```typescript
import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '@common/storage/clickhouse.service';

interface MarketData {
    day: string;
    market_id: string;
    total_volume: number;
}

@Injectable()
export class AnalyticsService {
    constructor(private readonly clickhouse: ClickHouseService) {}

    async getMarketVolume(marketId: string): Promise<MarketData[]> {
        const query = `
            SELECT
                toStartOfDay(created_at) AS day,
                market_id,
                sum(volume) AS total_volume
            FROM markets_analytics
            WHERE market_id = '${marketId}'
            GROUP BY day, market_id
            ORDER BY day DESC
        `;

        return this.clickhouse.query<MarketData>(query);
    }

    async trackEvent(event: any): Promise<void> {
        await this.clickhouse.insert('user_events', [event]);
    }
}
```

## Table Design Patterns

### MergeTree Engine (Most Common)

Used for standard time-series analytical data.

```sql
CREATE TABLE markets_analytics (
    date Date,
    market_id String,
    market_name String,
    volume UInt64,
    trades UInt32,
    unique_traders UInt32,
    avg_trade_size Float64,
    created_at DateTime
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, market_id)
SETTINGS index_granularity = 8192;
```

### ReplacingMergeTree (Deduplication)

Useful for data being synced from multiple sources where duplicates may occur.

```sql
CREATE TABLE user_events (
    event_id String,
    user_id String,
    event_type String,
    timestamp DateTime,
    properties String
) ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (user_id, event_id, timestamp)
PRIMARY KEY (user_id, event_id);
```

## Data Ingestion Patterns

### Batch Ingestion (Recommended)

ClickHouse performs best with large batch inserts rather than frequent single-row inserts.

```typescript
// Inside a NestJS Service
async ingestBatch(events: EventDto[]): Promise<void> {
    if (events.length === 0) return;

    // The ClickHouseService.insert method handles the JSONEachRow formatting
    await this.clickhouse.insert('events_table', events);
}
```

### Materialized Views for Real-time Aggregation

Instead of calculating sums onทุก query, use Materialized Views to pre-aggregate data.

```sql
-- Target table for results
CREATE TABLE market_stats_hourly (
    hour DateTime,
    market_id String,
    total_volume AggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree()
ORDER BY (hour, market_id);

-- Materialized View
CREATE MATERIALIZED VIEW market_stats_hourly_mv
TO market_stats_hourly
AS SELECT
    toStartOfHour(timestamp) AS hour,
    market_id,
    sumState(amount) AS total_volume
FROM trades
GROUP BY hour, market_id;
```

## Advanced Querying

### Quantiles and Percentiles

ClickHouse is extremely fast at calculating percentiles across billions of rows.

```typescript
async getLatencyPercentiles() {
    const query = `
        SELECT
            quantile(0.95)(latency_ms) AS p95,
            quantile(0.99)(latency_ms) AS p99
        FROM request_logs
        WHERE timestamp >= subtractHours(now(), 24)
    `;
    return this.clickhouse.query(query);
}
```

## Best Practices in NestJS

1. **Parameterize carefully**: Unlike standard SQL clients, `@clickhouse/client` doesn't always have built-in parameterization for all query types in the same way. Be mindful of SQL injection if concatenating strings inside `this.clickhouse.query()`.
2. **Handle Large Results**: If a query returns millions of rows, use a streaming approach or `LIMIT`.
3. **Column Order**: Put high-cardinality columns first in the `ORDER BY` clause of your table definitions to optimize index performance.
4. **Health Checks**: Use `this.clickhouse.healthCheck()` in your NestJS `Terminus` health indicators.

```typescript
// Example Health Indicator
@Injectable()
export class ClickHouseHealthIndicator extends HealthIndicator {
    constructor(private readonly clickhouse: ClickHouseService) {
        super();
    }

    async isHealthy(key: string) {
        const isConnected = await this.clickhouse.healthCheck();
        return this.getStatus(key, isConnected);
    }
}
```
