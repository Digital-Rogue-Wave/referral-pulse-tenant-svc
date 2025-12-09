#!/usr/bin/env bash
set -euo pipefail

# S3 bucket
awslocal s3 mb s3://referral-pulse || true

# SQS DLQ (FIFO)
awslocal sqs create-queue \
  --queue-name orders-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true || true

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "http://localhost:4566/000000000000/orders-dlq.fifo" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# SQS main (FIFO) with redrive
awslocal sqs create-queue \
  --queue-name orders.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true,"RedrivePolicy={\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}" || true

# SNS topic (optional)
awslocal sns create-topic --name catalog-events || true

echo "[localstack-init] bootstrap complete"
