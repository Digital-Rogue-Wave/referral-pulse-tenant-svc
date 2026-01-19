# Billing Module Implementation - Complete Task List

Architecture source of truth: `docs/specs/microservices-architecture.md`
- Tenant Service owns billing state (plans/subscriptions/payment_status) and publishes events.
- Integration Service owns emails/notifications and reacts to events.

## Phase 0: Architecture Alignment Refactors (must match `docs/specs/microservices-architecture.md`)

- [x] 0.1 Remove direct email sending from billing domain
    - Tenant Service publishes events only; Integration Service sends emails/notifications.

- [x] 0.2 Align Stripe webhook endpoint path with architecture
    - Architecture specifies `POST /webhooks/stripe`.
    - Current implementation supports `POST /webhooks/stripe` (see `src/webhook/webhooks.controller.ts`) while keeping `POST /api/v1/webhook/stripe` (see `src/webhook/webhook.controller.ts`) for backward compatibility.

- [x] 0.3 Align event names with architecture
    - Architecture lists `payment.failed`, `payment.restored`, plus `tenant.restricted`, `tenant.locked`, `tenant.restored`.
    - Publish architecture-contract events derived from internal `tenant.payment_status.changed` transitions.
    - Add/rename emitted events so cross-service consumers can rely on the architecture event contracts.

- [x] 0.4 Align SNS topic and event schema with architecture
    - Architecture describes a single SNS topic `referral-platform-events` and an event envelope with top-level `tenantId`.
    - Billing publishers use `referral-platform-events`, include top-level `tenantId`, and generate a unique `eventId` per event.
    - Update publishing to match the architecture envelope (unique `eventId`, top-level `tenantId`, consistent topic name).

- [x] 0.5 Ensure usage threshold + monthly summary become publishable events
    - `DailyUsageCalculator` and `MonthlyUsageResetService` persist `BillingEventEntity` rows but do not emit publishable events.
    - Add event emission (and SNS publishing) for:
        - `usage.threshold_crossed`
        - `usage.monthly_summary`
    - Integration Service can then send notifications.

- [x] 0.6 Ensure billing endpoints are protected per architecture
    - Auth is enforced globally via `APP_GUARD` (`JwtAuthGuard` then `KetoGuard`).

## Phase 1: Database & Core Entities

- [x] 1.1 Create Plan entity with TypeORM (REFER-312)
    - Create `PlanEntity` with fields: `name`, `stripe_price_id`, `stripe_product_id`, `interval` (monthly/annual)
    - Add `limits` JSONB column for storing plan limits (referred_users, campaigns, seats, etc.)
    - Add `tenant_id` field (null = public plan, specific value = custom enterprise plan) (REFER-330)
    - Add `is_active` boolean flag for soft deletion
    - Add `metadata` JSONB for additional configuration

- [x] 1.2 Create plan limits schema (JSONB) (REFER-313)
    - Define TypeScript interface for plan limits
    - Include fields: `referred_users`, `campaigns`, `seats`, `leaderboard_entries`, `email_sends`
    - Add validation for limit values
    - Create migration to add limits column to plans table

- [x] 1.3 Add trial fields to Tenant entity (REFER-335)
    - Add `trial_ends_at` timestamp field (nullable)
    - Add migration to populate existing tenants with default trial period
    - Add `trial_started_at` for tracking trial duration

- [x] 1.4 Add tenant status fields (REFER-342)
    - Add `status` enum field to Tenant (active, suspended, locked)
    - Add `payment_status` field for tracking payment state (REFER-307)
    - Add `suspended_at` and `locked_at` timestamps for audit
    - Create migration to update existing tenants

- [x] 1.5 Create TenantUsage entity for daily snapshots
    - Fields: `tenant_id`, `metric_name`, `period_date`, `current_usage`, `limit_value`
    - Composite unique index on `(tenant_id, metric_name, period_date)`
    - Purpose: Store daily/monthly usage snapshots for analytics and reporting

- [x] 1.6 Create BillingEvent entity for ClickHouse sync
    - Fields: `tenant_id`, `event_type`, `metric_name`, `increment`, `timestamp`, `metadata`
    - Index on `tenant_id` and `timestamp` for efficient querying
    - Purpose: Raw event data for debugging and detailed analytics

## Phase 2: Plan Management

- [x] 2.1 Implement CRUD endpoints for plans (admin only) (REFER-314)
    - `POST /admin/plans` - Create new plan
    - `GET /admin/plans` - List all plans (with pagination)
    - `GET /admin/plans/:id` - Get plan details
    - `PUT /admin/plans/:id` - Update plan
    - `DELETE /admin/plans/:id` - Soft delete plan
    - Apply admin-only authorization guard

- [x] 2.2 Create enterprise plan CRUD (admin only) (REFER-332)
    - Allow creating custom plans for specific tenants
    - Plans with `tenant_id` set are only visible to that tenant
    - Include `manual_invoicing` flag for enterprise billing (REFER-333)

- [x] 2.3 Filter plans by tenant visibility (REFER-331)
    - Public plans: `tenant_id IS NULL`
    - Enterprise plans: `tenant_id = :tenantId`
    - Implement query filtering in repository
    - Add tenant context to plan queries

- [x] 2.4 Sync plans with Stripe Products/Prices (REFER-315)
    - Implement Stripe products/prices sync logic in `PlanStripeSyncService`
    - Expose a safe way to trigger sync (e.g. admin/manual endpoint)
    - (Optional) Create a scheduled job to sync Stripe products to local database
    - Update `stripe_price_id` and `stripe_product_id` fields
    - Fetch and store Stripe metadata as plan limits
    - Handle new products, updated prices, and deleted products

- [x] 2.5 Cache plans in Redis (REFER-316)
    - Cache plan data with 1-hour TTL
    - Invalidate cache on plan updates
    - Fallback to database on cache miss
    - Use Redis hash for efficient plan lookups

- [x] 2.6 Implement GET /plans endpoint (public) (REFER-325)
    - Return only public plans (`tenant_id IS NULL`)
    - Include plan comparison data (REFER-326)
    - Calculate annual savings for annual plans (REFER-327)
    - Add recommendation logic based on usage patterns (REFER-328)

## Phase 3: Subscription Management

- [x] 3.1 Implement GET /billings/subscription endpoint (REFER-259)
    - Fetch subscription details from Stripe API
    - Calculate current usage metrics (REFER-261)
    - Include trial status and days remaining
    - Return SubscriptionDTO with all relevant data (REFER-262)

- [x] 3.2 Implement Stripe checkout session creation (REFER-264)
    - Create `POST /billings/subscription/checkout` endpoint (REFER-265)
    - Support for all plan types (Free, Starter, Growth, Enterprise)
    - Include metadata: `tenantId` (tenant account id), `planId` (billing plan id), `userId` (authenticated tenant **user** initiating checkout – never a tenant id or referee id)
    - Handle coupon validation (REFER-268)
    - Return session URL for redirect

- [x] 3.3 Handle Stripe webhook for checkout.session.completed (REFER-266)
    - Verify webhook signature
    - Extract metadata and update tenant billing_plan (REFER-267)
    - Publish `subscription.created` event (REFER-269)
    - Integration Service sends confirmation email/notifications (consuming billing events)

- [x] 3.4 Implement upgrade flow
    - Create `POST /billings/subscription/upgrade` endpoint (REFER-272)
    - Implement upgrade preview endpoint with proration (REFER-271)
    - Integrate Stripe subscription update with proration (REFER-273)
    - Update tenant plan immediately (REFER-274)
    - Integration Service sends upgrade confirmation email/notifications (consuming billing events)
    - Publish `subscription.upgraded` event (REFER-276)

- [x] 3.5 Implement downgrade flow
    - Create `POST /billings/subscription/downgrade` endpoint (REFER-279)
    - Implement usage vs plan limit validation (REFER-278)
    - Schedule Stripe subscription change for period end (REFER-280)
    - Store pending downgrade in database (REFER-281)
    - Integration Service sends downgrade scheduled email/notifications (consuming billing events)
    - Publish `subscription.downgrade_scheduled` event (REFER-283)
    - Implement cancel pending downgrade endpoint (REFER-281)

- [x] 3.6 Implement cancellation flow
    - Create `POST /billings/subscription/cancel` endpoint (REFER-286)
    - Integrate Stripe cancel at period end (REFER-287)
    - Store cancellation reason (REFER-288)
    - Integration Service sends cancellation confirmation email/notifications (consuming billing events)
    - Implement reactivation endpoint (REFER-290)
    - Handle subscription expiry via Stripe webhook (REFER-291)
    - Publish `subscription.cancelled` event (REFER-292)

- [x] 3.7 Handle early upgrade during trial (REFER-340)
    - Allow upgrading before trial ends
    - Pro-rate charges appropriately
    - End trial immediately on upgrade
    - Update trial status accordingly

## Phase 4: Payment & Invoice Management

- [x] 4.1 Payment method management
    - Create Stripe SetupIntent for adding card (REFER-294)
    - Implement `POST /billings/payment-methods` endpoint (REFER-295)
    - Implement `GET /billings/payment-methods` endpoint (REFER-296)
    - Implement `DELETE /payment-methods/:id` endpoint (REFER-297)
    - Handle payment method update in Stripe (REFER-298)

- [x] 4.2 Invoice management
    - Implement `GET /billings/invoices` endpoint (REFER-300)
    - Integrate Stripe invoice listing (REFER-301)
    - Add invoice PDF download via Stripe (REFER-302)
    - Implement upcoming invoice preview (REFER-303)

- [x] 4.3 Payment failure handling
    - Handle `invoice.payment_failed` webhook (REFER-305)
    - Integration Service sends failed payment email/notifications (consuming `payment.failed` / `tenant.payment_status.changed`)
    - Implement grace period logic (REFER-308)
    - Create payment required guard (REFER-309)
    - Handle `invoice.paid` webhook for restoration (REFER-310)

- [x] 4.4 Internal tenant billing status endpoint (architecture contract)
    - Implement `GET /internal/tenants/:id/status` for other services (Tracker/Campaign/etc.)
    - Response should include:
        - Tenant status (active/suspended/locked)
        - Payment enforcement status (see 4.5)
        - Current billing plan + subscription status
    - Used by other services for fast allow/deny decisions and caching
    - Tasks:
        - Define a stable DTO/response schema (versionable) for cross-service consumption
        - Enforce service-to-service auth (service token + Keto policy)
        - Source-of-truth fields:
            - Tenant: `status`, `paymentStatus`, `trialStartedAt`, `trialEndsAt`
            - Billing: `plan`, `status` (subscription status), Stripe identifiers if needed
        - Add caching semantics appropriate for internal calls (short TTL + explicit cache headers if used behind an internal gateway)
        - Ensure behavior is safe when a tenant has no `BillingEntity` (default plan enforcement)

- [x] 4.5 Align `payment_status` with architecture state machine
    - Architecture expects: `active | past_due | restricted | locked`
    - Current implementation models: `pending | completed | failed`
    - Requires enum + DB migration + guard behavior updates (breaking)
    - Decide whether to:
        - Implement full state machine in tenant-svc, or
        - Document and keep simplified status until the wider platform is ready
    - Required direction: implement full alignment in tenant-svc
    - Tasks:
        - Update `PaymentStatusEnum` to: `ACTIVE`, `PAST_DUE`, `RESTRICTED`, `LOCKED`
        - Add DB migration for tenant `payment_status` values (map existing values deterministically)
        - Persist enough timestamps to support deterministic transitions (e.g. `paymentPastDueAt`, `paymentRestrictedAt`, `paymentLockedAt` or `lastPaymentFailureAt` + derived transitions)
        - Stripe webhook mapping:
            - `invoice.payment_failed` => set `paymentStatus=PAST_DUE` and record start timestamp
            - `invoice.paid` (or successful payment signal) => set `paymentStatus=ACTIVE` and clear/close failure window
        - Transition mechanism:
            - Scheduled job to move `PAST_DUE -> RESTRICTED -> LOCKED` based on elapsed time
        - Enforcement behavior:
            - Update `PaymentRequiredGuard` to enforce per-state behavior (warn/read-only/deny)
            - Ensure other guards (usage/limits) are consistent with state rules
        - Events for workflow side effects:
            - Publish payment/account-state transition events for Temporal workflows (emails, campaign pausing)
            - Ensure DLQ-safe, idempotent event publishing and consumers (cross-service)

## Phase 5: Usage Tracking System

- [x] 5.1 Create UsageTracker service (REFER-318)
    - Track usage across different metrics
    - Store usage in database with daily rollups
    - Provide methods for incrementing and checking usage

- [x] 5.2 Implement usage check middleware (REFER-319)
    - Intercept resource creation requests
    - Check if tenant has available capacity
    - Block requests that exceed limits
    - Return appropriate error messages

- [x] 5.3 Add usage increment on resource creation (REFER-320)
    - Increment usage counters when:
        - Creating new campaigns
        - Adding team members
        - Sending referral emails
        - Generating referral links
    - Decrement on resource deletion

- [x] 5.4 Implement monthly usage reset (Bull job) (REFER-321)
    - Scheduled job to reset usage counters at billing cycle start
    - Archive current month's usage to historical table
    - Reset counters for new billing period
    - Integration Service sends usage summary notifications/emails (consuming usage summary events)

- [x] 5.5 Create limit exceeded exception (REFER-322)
    - Custom exception for plan limit violations
    - Include details: metric, current usage, limit
    - Provide upgrade suggestions
    - HTTP 402 status code

- [x] 5.6 Implement GET /billings/usage endpoint (REFER-323)
    - Return current usage across all metrics
    - Include limits and percentage used
    - Provide historical usage data
    - Show usage trends and projections

- [x] 5.7 Implement Redis counters for real-time tracking
    - Create `RedisUsageService` for atomic operations
    - Define Redis key structure:
        - `usage:{tenant_id}:{metric}:{YYYY-MM}` → counter
        - `limits:{tenant_id}:{metric}` → limit value
        - `thresholds:{tenant_id}:{metric}:80` → notification flag
    - Implement atomic INCR/DECR operations
    - Add TTL management (auto-expire after 60 days)

- [x] 5.8 Create SQS consumer for referral events
    - Design SNS event format for referral actions
    - Create `ReferralEventProcessor` service
    - Consume events from referral service SQS queue
    - Validate and process events
    - Call `RedisUsageService.trackUsage()`
    - Publish to ClickHouse for analytics

- [x] 5.9 Implement daily usage calculation cron
    - Create `DailyUsageCalculator` service
    - Runs at midnight UTC via NestJS scheduler
    - For each tenant:
        - Read Redis counters for all metrics
        - Save snapshot to `TenantUsageEntity`
        - Check thresholds (80%, 100%)
        - Publish threshold-crossed events; Integration Service sends notifications
    - Archive or reset Redis keys as needed

## Phase 6: Limit Enforcement

- [x] 6.1 Implement usage vs plan limit validation (REFER-278)
    - Compare current usage against plan limits
    - Return validation result with details
    - Support for multiple metrics validation
    - Consider trial period allowances

- [x] 6.2 Create limit exceeded exception (REFER-322)
    - Custom HTTP exception with 402 status
    - Include helpful error message
    - Suggest upgrade options
    - Link to billing portal

- [x] 6.3 Create BillingGuard for automatic enforcement
    - Implement `CanActivate` interface
    - Check tenant subscription status
    - Validate usage against plan limits
    - Return 402 Payment Required if limit exceeded
    - Respect trial period (allow during trial)
    - Apply at service boundaries (this service and/or other services calling tenant-svc for enforcement)

- [x] 6.4 Implement hard cut-off at limits
    - Block resource creation when limits reached
    - Return clear error messages
    - Provide upgrade path in response
    - Allow configurable grace percentage (e.g., 10%)

- **(External)** 6.5 Add leaderboard limiting logic
    - Modify leaderboard queries to accept limit parameter
    - Only return top N users where N = `leaderboard_entries` limit
    - Add note in response: "Showing top X of Y (plan limit)"
    - Create `LeaderboardService.withLimits()` wrapper
    - Note: current repo contains only a demo endpoint under `TestBillingController`; actual leaderboard queries must be limited at the real leaderboard read path.
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Implement in the service that owns the real leaderboard read/query path; tenant-svc can only provide plan limits + billing status.

- [x] 6.6 Create PlanLimitService utility
    - `getPlanLimits(tenantId)`: Returns current plan limits
    - `canPerformAction(tenantId, action, count = 1)`: Checks if allowed
    - `getRemainingCapacity(tenantId, metric)`: Returns remaining count
    - `enforceLimit(tenantId, metric, value)`: Throws if limit exceeded

## Phase 7: Trial Management

- [x] 7.1 Set trial on tenant creation (REFER-336)
    - Automatically set `trial_ends_at` on new tenant creation
    - Default 14-day trial period
    - Set `trial_started_at` to creation timestamp
    - Initialize with starter plan limits during trial

- [x] 7.2 Create trial expiry check middleware (REFER-337)
    - Check trial status on each request
    - Block actions if trial expired and no subscription
    - Return appropriate error messages
    - Redirect to upgrade page

- [x] 7.3 Schedule trial reminder emails (Bull job) (REFER-338)
    - Send reminder 3 days before trial ends
    - Send final reminder 1 day before trial ends
    - Send trial expired notification
    - Integration Service owns reminder emails/notifications; Tenant Service should emit the relevant events for workflows

- [x] 7.4 Handle trial expiry (downgrade to free) (REFER-339)
    - Automatically downgrade to free plan after trial
    - Set reduced limits for free tier
    - Integration Service sends downgrade notification email/notifications (consuming events)
    - Update subscription status

- [x] 7.5 Implement early upgrade during trial (REFER-340)
    - Allow upgrading before trial ends
    - End trial immediately on upgrade
    - Pro-rate charges if applicable
    - Update trial status flags

## Phase 8: Tenant Status Management

- [x] 8.1 Create POST /admin/tenants/:id/suspend endpoint (REFER-343)
    - Admin-only endpoint for suspending tenants
    - Update tenant status to 'suspended'
    - Set `suspended_at` timestamp
    - Publish `tenant.suspended` event (REFER-345)

- **(External)** 8.2 Handle campaign pausing in Campaign Service (REFER-346)
    - Listen for `tenant.suspended` event
    - Pause all active campaigns for suspended tenant
    - Stop email sends and referral tracking
    - Update campaign statuses
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Campaign Service (consumer of `tenant.suspended` / billing status events).

- **(External)** 8.3 Send suspension notification (REFER-347)
    - Integration Service sends suspension email/notifications (consuming `tenant.suspended`)
    - Include suspension reason and duration
    - Provide contact information for support
    - Include restoration instructions
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Integration Service (emails/notifications triggered by events).

- [x] 8.4 Implement unsuspend endpoint (REFER-348)
    - Admin-only endpoint for restoring tenants
    - Update tenant status to 'active'
    - Resume paused campaigns
    - Send restoration confirmation

- [x] 8.5 Implement POST /tenants/:id/lock endpoint (REFER-350/351)
    - Admin endpoint for locking tenant accounts
    - Update status to 'locked'
    - Require password confirmation via Ory (REFER-353)
    - Prevent all access while locked

- [x] 8.6 Implement unlock with password (REFER-355/356)
    - Admin endpoint for unlocking tenants
    - Verify admin credentials via Ory
    - Update status back to 'active'
    - Send unlock notification

- [x] 8.7 Add auto-unlock Bull job (REFER-357)
    - Scheduled job to automatically unlock tenants after set period
    - Configurable lock duration
    - Send auto-unlock notification
    - Update audit logs

- [x] 8.8 Create tenant status guard (REFER-344)
    - Middleware to check tenant status on all requests
    - Block access for suspended/locked tenants
    - Return appropriate HTTP status codes
    - Include status in response headers

## Phase 9: Analytics & Monitoring

- **(External)** 9.1 Design ClickHouse schema for billing analytics
    - Create `billing_events` table for raw events
    - Create `tenant_usage_daily` for aggregated usage
    - Create `subscription_changes` for audit trail
    - Set up appropriate indexes for query performance
    - Configure data retention policies (e.g., 1 year)
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Analytics Service / analytics data store.

- **(External)** 9.2 Create ClickHouseService
    - Connection management with connection pooling
    - Batch insert operations for performance
    - Query methods for common analytics queries
    - Error handling and retry logic
    - Health check endpoint
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Analytics Service.

- **(External)** 9.3 Integrate ClickHouse with event processors
    - Log all billing events to ClickHouse
    - Log usage calculations and threshold crossings
    - Log subscription changes and payment events
    - Implement async batching for high-volume writes
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Analytics Service (event ingestion pipeline).

- **(External)** 9.4 Create billing analytics endpoints
    - `GET /billing/analytics/usage-trends` - Usage trends over time
    - `GET /billing/analytics/revenue` - MRR and revenue analytics
    - `GET /billing/analytics/conversion` - Trial to paid conversion rates
    - `GET /billing/debug/events` - Raw events for debugging
    - Admin-only access for sensitive analytics
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Analytics Service; tenant-svc should publish events + persist billing state only.

- **(External)** 9.5 Implement monitoring and alerts
    - Add metrics collection:
        - Counters: `billing_usage_total`, `billing_limit_exceeded_total`
        - Gauges: `billing_usage_percentage`, `active_trials_count`
        - Histograms: `billing_checkout_duration_ms`
    - Set up alerts:
        - High percentage of tenants hitting limits
        - Failed Stripe webhooks
        - Redis memory usage for counters
        - ClickHouse ingestion errors
    - Create Grafana dashboards for billing metrics
    > **Scope/Owner:** Cross-service observability work. Tenant Service can expose metrics, but alerting/dashboards are owned by Platform/DevOps (and ClickHouse ingestion alerts by Analytics Service).

- **(External)** 9.6 Create billing report generation
    - Monthly usage reports for tenants
    - Revenue reports for admin
    - Trial conversion reports
    - Export to CSV/PDF formats
    - Scheduled email delivery of reports
    > **Scope/Owner:** Cross-service feature. Analytics Service owns report generation; Integration Service owns scheduled delivery (emails/notifications).

## Phase 10: Testing

- [x] 10.1 Write unit tests for subscription endpoints (REFER-263)
    - Test checkout session creation
    - Test webhook signature verification
    - Test subscription status retrieval
    - Test error handling scenarios

- [x] 10.2 Write integration tests for checkout flow (REFER-270)
    - End-to-end checkout process
    - Stripe webhook handling
    - Database state updates
    - Event publishing verification

- [x] 10.3 Write integration tests for upgrades (REFER-277)
    - Upgrade flow with proration
    - Plan validation logic
    - Stripe API integration
    - Email notifications

- [x] 10.4 Write integration tests for cancellation (REFER-285)
    - Cancel at period end flow
    - Reactivation process
    - Status updates
    - Event publishing

- [x] 10.5 Write integration tests for payment methods (REFER-293)
    - Add/remove payment methods
    - SetupIntent creation
    - Default payment method updates
    - Error scenarios

- [x] 10.6 Write integration tests for invoices (REFER-299)
    - Invoice listing
    - PDF download
    - Upcoming invoice preview
    - Payment history

- [x] 10.7 Write unit tests for payment failure (REFER-304)
    - Grace period logic
    - Payment required guard
    - Notification sending
    - Restoration flow

- [x] 10.8 Write integration tests for complete flow (REFER-311)
    - Complete subscription lifecycle
    - Plan changes and proration
    - Usage tracking integration
    - End-to-end billing scenarios

- [x] 10.9 Write unit tests for plan sync (REFER-317)
    - Stripe product synchronization
    - Cache invalidation
    - Plan CRUD operations
    - Validation logic

- [x] 10.10 Write unit tests for usage tracking (REFER-324)
    - Usage increment/decrement
    - Limit checking
    - Monthly reset logic
    - Threshold notifications

- [x] 10.11 Write unit tests for trial management (REFER-334)
    - Trial creation and expiry
    - Early upgrade handling
    - Reminder scheduling
    - Downgrade logic

- [x] 10.12 Write unit tests for early upgrade (REFER-341)
    - Trial period calculations
    - Proration logic
    - Status updates
    - Email notifications

- [x] 10.13 Write unit tests for suspension (REFER-349)
    - Suspend/unsuspend flow
    - Campaign pausing
    - Event publishing
    - Access blocking

- [x] 10.14 Write unit tests for locking (REFER-358)
    - Lock/unlock functionality
    - Password confirmation
    - Auto-unlock scheduling
    - Status validation

- **(External)** 10.15 Write load tests for Redis counters
    - High-volume increment operations
    - Concurrent limit checks
    - Memory usage under load
    - Performance benchmarking
    > **Scope/Owner:** Not required for Tenant Service microservices contract alignment. Typically owned by QA/Performance or a dedicated load-test harness repo; can be added later.

- **(External)** 10.16 Write integration tests for ClickHouse
    - Data ingestion performance
    - Query response times
    - Batch processing
    - Error recovery
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Analytics Service test suite.

- **(External)** 10.17 Write E2E tests for billing scenarios
    - Complete user journey: signup → trial → upgrade → usage → cancellation
    - Admin billing management flows
    - Error scenarios and recovery
    - Mobile/responsive testing
    > **Scope/Owner:** Cross-service E2E. Typically owned by a dedicated E2E test harness spanning multiple services; not implemented solely inside tenant-svc.

## Phase 11: Deployment & Documentation

- **(External)** 11.1 Infrastructure setup
    - Redis cluster configuration for production
    - ClickHouse cluster setup and tuning
    - SQS queues and SNS topics creation
    - Stripe webhook endpoint configuration
    - Load balancer setup for webhook endpoints
    > **Scope/Owner:** Out of scope for Tenant Service code changes. Owner is Platform/DevOps/Infra.

- **(External)** 11.2 Environment configuration
    - Stripe API keys (test/production separation)
    - Plan limit overrides per environment
    - Redis connection strings and pooling config
    - ClickHouse credentials and connection pooling
    - Feature flags for gradual rollout
    > **Scope/Owner:** Out of scope for Tenant Service code changes. Owner is Platform/DevOps (config + secrets management).

- **(External)** 11.3 Database migrations for production
    - Production migration scripts with rollback procedures
    - Data backfill for existing tenants
    - Index optimization for query performance
    - Partitioning strategy for large tables
    - Backup and recovery procedures
    > **Scope/Owner:** Cross-cutting release work. Migrations live here, but production rollout/rollback/backfill is owned by Platform/DevOps with DB ownership.

- **(External)** 11.4 API documentation
    - Update OpenAPI/Swagger specifications
    - Document all billing endpoints
    - Include request/response examples
    - Add authentication requirements
    - Document error codes and responses
    > **Scope/Owner:** Cross-service docs work. Owner is API/docs owner; tenant-svc can expose Swagger, but canonical docs often live in a shared docs repo.

- **(External)** 11.5 User documentation
    - Plan comparison table with features and limits
    - Step-by-step guide for subscription management
    - Usage tracking explanation
    - Trial period FAQ
    - Troubleshooting common issues
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Product/Docs (end-user facing documentation).

- **(External)** 11.6 Admin documentation
    - Tenant management procedures
    - Billing exception handling
    - Report generation instructions
    - Monitoring and alert setup
    - Disaster recovery procedures
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Ops/Docs/Platform.

- **(External)** 11.7 SDK documentation
    - TypeScript SDK billing methods
    - Webhook setup instructions
    - Integration examples
    - Error handling best practices
    - Testing strategies
    > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is SDK repo/SDK maintainers; tenant-svc provides APIs/events.

- **(External)** 11.8 Deployment checklist
    - Database migrations applied
    - Environment variables configured
    - Stripe webhook endpoint verified
    - SQS queues created and subscribed
    - Redis and ClickHouse clusters healthy
    - Monitoring dashboards setup
    - Alerting configured and tested
    - Rollback procedures documented
    > **Scope/Owner:** Out of scope for Tenant Service code changes. Owner is Platform/DevOps release process.
