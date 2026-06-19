#!/usr/bin/env bash
set -euo pipefail

echo "[run-all] Setting up AWS resources from environment variables..."

# Run setup scripts
echo "[run-all] Running setup-s3.js..."
node ./setup-s3.js || true

echo "[run-all] Running setup-sqs.js..."
node ./setup-sqs.js || true

echo "[run-all] Running setup-sns.js..."
node ./setup-sns.js || true

echo "[run-all] All setup scripts completed!"
