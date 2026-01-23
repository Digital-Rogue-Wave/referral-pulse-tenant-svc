# Local Development Environment

Docker Compose setup for local development with all required services.

## Services

- **PostgreSQL 16** - Main database (port 5432)
- **Redis 7** - Cache and pub/sub (port 6379)
- **ClickHouse 23** - Analytics database (port 8123)
- **LocalStack 3** - AWS services emulation (port 4566)
  - S3 (object storage)
  - SQS (message queues)
  - SNS (pub/sub topics)

## Quick Start

### 1. Start all services

```bash
cd deployment/local
docker-compose up -d
```

### 2. Check service health

```bash
docker-compose ps
```

All services should show `healthy` status.

### 3. View logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f localstack
docker-compose logs -f postgres
```

### 4. Stop services

```bash
docker-compose down

# Remove volumes (wipes all data)
docker-compose down -v
```

## LocalStack Resources

The bootstrap script automatically creates:

### S3 Buckets
- `campaign-assets-dev`

### SQS FIFO Queues (7 queues)
- `campaign-events.fifo`
- `referral-events.fifo`
- `reward-events.fifo`
- `user-events.fifo`
- `notification-events.fifo`
- `analytics-events.fifo`
- `workflow-events.fifo`

### SNS Topics
- `campaign-notifications`

## LocalStack Web UI

Access LocalStack resources via web interface:

**URL:** https://app.localstack.cloud

**Configuration:**
1. Go to https://app.localstack.cloud
2. Click "Connect to LocalStack"
3. Enter endpoint: `http://localhost:4566`
4. Browse S3 buckets, SQS queues, SNS topics

No account required for basic usage!

## AWS CLI (LocalStack)

### Using awslocal

```bash
# Install awslocal
pip install awscli-local

# List SQS queues
awslocal sqs list-queues

# List S3 buckets
awslocal s3 ls

# Send message to queue
awslocal sqs send-message \
  --queue-url http://localhost:4566/000000000000/campaign-events.fifo \
  --message-body '{"test": "data"}' \
  --message-group-id test \
  --message-deduplication-id $(uuidgen)
```

### Using AWS CLI

```bash
# Configure with fake credentials
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=eu-central-1

# Use --endpoint-url
aws --endpoint-url=http://localhost:4566 sqs list-queues
```

## Database Connections

### PostgreSQL

```bash
# Connection string
postgresql://root:root@localhost:5432/referral-db

# CLI access
docker exec -it rp-postgres psql -U root -d referral-db
```

### Redis

```bash
# Connection string
redis://localhost:6379

# CLI access
docker exec -it rp-redis redis-cli
```

### ClickHouse

```bash
# HTTP endpoint
http://localhost:8123

# CLI access
docker exec -it rp-clickhouse clickhouse-client
```

## Environment Variables

Update `.env.development` to match these services:

```bash
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=root
DATABASE_PASSWORD=root
DATABASE_NAME=referral-db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# AWS LocalStack
AWS_ENDPOINT=http://localhost:4566
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

## Troubleshooting

### Services not starting

```bash
# Check Docker daemon is running
docker ps

# Check logs for errors
docker-compose logs
```

### LocalStack bootstrap failed

```bash
# Re-run bootstrap manually
docker exec rp-localstack bash /etc/localstack/init/ready.d/bootstrap.sh
```

### Reset all data

```bash
# Stop and remove all volumes
docker-compose down -v

# Start fresh
docker-compose up -d
```

### Port conflicts

If ports are already in use, edit `docker-compose.yaml`:

```yaml
ports:
  - "5433:5432"  # Changed PostgreSQL port
```
