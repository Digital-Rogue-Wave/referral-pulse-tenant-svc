#!/usr/bin/env bash
set -euo pipefail

echo "[localstack-init] Starting bootstrap..."

# S3 bucket
echo "Creating S3 bucket..."
awslocal s3 mb s3://campaign-assets-dev || true

# FIFO Queues matching .env.development
# All queues are FIFO with content-based deduplication

QUEUES=(
  "campaign-events"
  "referral-events"
  "reward-events"
  "user-events"
  "notification-events"
  "analytics-events"
  "workflow-events"
)

echo "Creating FIFO queues..."
for queue in "${QUEUES[@]}"; do
  echo "  - ${queue}.fifo"
  awslocal sqs create-queue \
    --queue-name "${queue}.fifo" \
    --attributes FifoQueue=true,ContentBasedDeduplication=true \
    --region eu-central-1 || true
done

# SNS topics
echo "Creating SNS topics..."
awslocal sns create-topic \
  --name campaign-notifications \
  --region eu-central-1 || true

echo "[localstack-init] Bootstrap complete!"
echo ""
echo "Resources created:"
echo "  - S3 Bucket: s3://campaign-assets-dev"
echo "  - SQS Queues: ${#QUEUES[@]} FIFO queues"
echo "  - SNS Topics: campaign-notifications"
echo ""
echo "Access LocalStack Web UI: https://app.localstack.cloud"
echo "  - Connect to: http://localhost:4566"
echo ""
