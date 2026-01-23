# Referral Pulse Service - Helm Chart

Kubernetes Helm chart for deploying the Referral Pulse microservice (NestJS + PostgreSQL + Redis + SQS/SNS).

## Features

- **IRSA (IAM Roles for Service Accounts)** - AWS credentials via Kubernetes service account annotations
- **Horizontal Pod Autoscaling (HPA)** - Auto-scales based on CPU/memory
- **Pod Disruption Budget (PDB)** - Ensures high availability during disruptions
- **Network Policies** - Deny-all-ingress by default with explicit allow rules
- **ServiceMonitor** - Prometheus metrics scraping via ServiceMonitor CRD
- **Migration Job** - Pre-install/pre-upgrade database migration hook
- **Health Probes** - Liveness and readiness checks on `/health` endpoint
- **OpenTelemetry** - Distributed tracing and metrics export

## Prerequisites

- Kubernetes 1.24+
- Helm 3.8+
- AWS Load Balancer Controller (for ALB ingress)
- Prometheus Operator (for ServiceMonitor)
- External DNS (optional, for automatic DNS records)

## Quick Start

### 1. Install for Staging

```bash
helm upgrade --install referral-svc ./deployment/helm \
  --namespace default \
  --create-namespace \
  --values ./deployment/helm/values.yaml
```

### 2. Install for Production

```bash
helm upgrade --install referral-svc ./deployment/helm \
  --namespace production \
  --create-namespace \
  --values ./deployment/helm/values-production.yaml
```

### 3. Verify Deployment

```bash
# Check pod status
kubectl get pods -l app.kubernetes.io/name=referral-svc

# Check service account IRSA annotation
kubectl get sa -o yaml | grep eks.amazonaws.com/role-arn

# Check ingress
kubectl get ingress

# View logs
kubectl logs -l app.kubernetes.io/name=referral-svc --tail=100 -f
```

## Configuration

### Required Changes Before Deployment

#### 1. Update IAM Role ARN (values.yaml)

```yaml
serviceAccount:
  irsa:
    roleArn: arn:aws:iam::YOUR_AWS_ACCOUNT:role/YOUR_ROLE_NAME
```

#### 2. Update Image Repository (values.yaml)

```yaml
image:
  repository: YOUR_ECR_REGISTRY/referral-pulse-svc
  tag: "YOUR_IMAGE_TAG"
```

#### 3. Update SQS Queue URLs (values.yaml)

Replace `123456789012` with your AWS account ID:

```yaml
SQS_QUEUE_CAMPAIGN_EVENTS: "https://sqs.eu-central-1.amazonaws.com/YOUR_ACCOUNT/campaign-events.fifo"
SQS_QUEUE_REFERRAL_EVENTS: "https://sqs.eu-central-1.amazonaws.com/YOUR_ACCOUNT/referral-events.fifo"
# ... etc
```

#### 4. Update SNS Topic ARN (values.yaml)

```yaml
SNS_TOPIC_ARN: "arn:aws:sns:eu-central-1:YOUR_ACCOUNT:campaign-notifications"
```

#### 5. Update Auth Configuration (values.yaml)

```yaml
AUTH_JWKS_URI: "https://YOUR_AUTH_PROVIDER/.well-known/jwks.json"
AUTH_ISSUER: "https://YOUR_AUTH_PROVIDER/"
AUTH_AUDIENCE: "your-api-audience"
```

#### 6. Update Database Credentials (values.yaml)

```yaml
envVars:
  DATABASE_HOST: "your-rds-endpoint.eu-central-1.rds.amazonaws.com"
  DATABASE_NAME: "your_database_name"
  DATABASE_USERNAME: "your_username"

secretVars:
  DATABASE_PASSWORD: "your-secure-password"
```

#### 7. Update Redis Configuration (values.yaml)

```yaml
envVars:
  REDIS_HOST: "your-elasticache-endpoint.cache.amazonaws.com"
  REDIS_TLS_ENABLED: "true"  # Enable for production

secretVars:
  REDIS_PASSWORD: "your-redis-password"  # If auth enabled
```

## Environment-Specific Configuration

### Staging (values.yaml)
- 3 replicas, max 20
- Smaller resource requests/limits
- Development/staging AWS resources
- OTEL to staging collector

### Production (values-production.yaml)
- 5 replicas, max 50
- Larger resource requests/limits
- Production AWS resources
- OTEL to Grafana Cloud
- SSL/TLS enabled for databases
- Topology spread constraints for HA
- ACM certificate for HTTPS

## IRSA Setup

This chart uses **IRSA (IAM Roles for Service Accounts)** instead of AWS access keys.

### Create IAM Role

```bash
# Create trust policy
cat > trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT:oidc-provider/oidc.eks.REGION.amazonaws.com/id/YOUR_CLUSTER_ID"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.REGION.amazonaws.com/id/YOUR_CLUSTER_ID:sub": "system:serviceaccount:NAMESPACE:SERVICE_ACCOUNT_NAME"
        }
      }
    }
  ]
}
EOF

# Create IAM role
aws iam create-role \
  --role-name referral-pulse-svc-role \
  --assume-role-policy-document file://trust-policy.json

# Attach policies (adjust as needed)
aws iam attach-role-policy \
  --role-name referral-pulse-svc-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

aws iam attach-role-policy \
  --role-name referral-pulse-svc-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess

aws iam attach-role-policy \
  --role-name referral-pulse-svc-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSNSFullAccess
```

### Update Helm Chart

```yaml
serviceAccount:
  irsa:
    enabled: true
    roleArn: arn:aws:iam::YOUR_ACCOUNT:role/referral-pulse-svc-role
```

## Network Policies

The chart creates network policies that:

1. **Deny all ingress by default** - No pod can reach the service unless explicitly allowed
2. **Allow from ALB ingress controller** - Only the ALB controller can reach port 8080
3. **Allow from Prometheus** - Prometheus can scrape `/metrics`
4. **Allow egress to:**
   - DNS (kube-dns)
   - OTEL collector
   - Internet (for S3/SQS/SNS/external APIs)

### Customize Network Policies

```yaml
networkPolicy:
  enabled: true
  allowFromIngressController:
    namespaceSelector:
      matchLabels:
        app.kubernetes.io/name: aws-load-balancer-controller  # Adjust to your setup
  allowFromPrometheus:
    namespaceSelector:
      matchLabels:
        name: monitoring  # Adjust to your Prometheus namespace
```

## Database Migrations

Migrations run automatically as a Kubernetes Job before install/upgrade:

- **Hook:** `pre-install,pre-upgrade`
- **Command:** `node dist/database/run-migrations.js`
- **Failure handling:** If migration fails, Helm rollback will occur

### Manual Migration

```bash
kubectl run migrate-manual --rm -it \
  --image=YOUR_IMAGE \
  --env-from=configmap/referral-svc-config \
  --env-from=secret/referral-svc-secret \
  -- node dist/database/run-migrations.js
```

## Monitoring

### Prometheus Metrics

The chart creates a `ServiceMonitor` resource for automatic Prometheus scraping:

- **Endpoint:** `/metrics`
- **Port:** `8080`
- **Interval:** `15s`
- **Timeout:** `10s`

### View Metrics

```bash
# Port-forward to access metrics locally
kubectl port-forward svc/referral-svc 8080:8080

# Query metrics
curl http://localhost:8080/metrics
```

### OpenTelemetry

Traces and metrics are exported to OTEL collector:

```yaml
OTEL_ENABLED: "true"
OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.otel.svc.cluster.local:4318"
```

For production, point to Grafana Cloud:

```yaml
OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp-gateway-prod-eu-central-0.grafana.net/otlp"
OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic <base64-token>"
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod -l app.kubernetes.io/name=referral-svc

# Check logs
kubectl logs -l app.kubernetes.io/name=referral-svc --all-containers

# Check migration job
kubectl logs job/referral-svc-migrate
```

### IRSA Not Working

```bash
# Verify service account annotation
kubectl get sa referral-svc -o yaml | grep eks.amazonaws.com/role-arn

# Check pod has the AWS token volume mounted
kubectl get pod POD_NAME -o yaml | grep aws-iam-token

# Test AWS credentials inside pod
kubectl exec -it POD_NAME -- env | grep AWS
```

### Network Policy Blocking Traffic

```bash
# Temporarily disable network policies
helm upgrade referral-svc ./deployment/helm --set networkPolicy.enabled=false

# Check network policy rules
kubectl get networkpolicy
kubectl describe networkpolicy referral-svc-deny-all-ingress
```

### Health Check Failing

```bash
# Check health endpoint
kubectl port-forward svc/referral-svc 8080:8080
curl http://localhost:8080/health

# Adjust probe timing if needed
helm upgrade referral-svc ./deployment/helm \
  --set livenessProbe.initialDelaySeconds=60 \
  --set readinessProbe.initialDelaySeconds=30
```

## Values Reference

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of pod replicas | `3` |
| `image.repository` | Container image repository | `docker.io/...` |
| `image.tag` | Container image tag | `latest` |
| `serviceAccount.irsa.enabled` | Enable IRSA | `true` |
| `serviceAccount.irsa.roleArn` | IAM role ARN | `arn:aws:iam::...` |
| `resources.limits.cpu` | CPU limit | `500m` |
| `resources.limits.memory` | Memory limit | `512Mi` |
| `autoscaling.enabled` | Enable HPA | `true` |
| `autoscaling.minReplicas` | Minimum replicas | `3` |
| `autoscaling.maxReplicas` | Maximum replicas | `20` |
| `networkPolicy.enabled` | Enable network policies | `true` |
| `serviceMonitor.enabled` | Enable Prometheus scraping | `true` |
| `migrations.enabled` | Run migration job | `true` |

See [values.yaml](./values.yaml) for full configuration options.

## Upgrading

### Upgrade Staging

```bash
helm upgrade referral-svc ./deployment/helm \
  --namespace default \
  --values ./deployment/helm/values.yaml
```

### Upgrade Production (with confirmation)

```bash
helm diff upgrade referral-svc ./deployment/helm \
  --namespace production \
  --values ./deployment/helm/values-production.yaml

# If diff looks good, apply
helm upgrade referral-svc ./deployment/helm \
  --namespace production \
  --values ./deployment/helm/values-production.yaml
```

## Uninstall

```bash
helm uninstall referral-svc --namespace default
```

**Note:** This does NOT delete:
- PersistentVolumeClaims
- Secrets created outside Helm
- AWS resources (S3, SQS, RDS, etc.)

## Best Practices

1. **Always use values files** - Don't override with `--set` in production
2. **Version your images** - Never use `:latest` in production
3. **Store secrets externally** - Use AWS Secrets Manager + External Secrets Operator
4. **Review diffs** - Always run `helm diff` before upgrading production
5. **Test migrations** - Run migrations in staging first
6. **Monitor rollouts** - Watch pod status during upgrades
7. **Use IRSA** - Never hardcode AWS credentials in values

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
- name: Deploy to Staging
  run: |
    helm upgrade --install referral-svc ./deployment/helm \
      --namespace staging \
      --values ./deployment/helm/values.yaml \
      --set image.tag=${{ github.sha }} \
      --wait --timeout 5m
```

## Support

For issues or questions:
- Check [TECH_DOC.md](../../TECH_DOC.md) for application documentation
- Review Helm chart templates in `templates/`
- Check Kubernetes events: `kubectl get events --sort-by=.lastTimestamp`
