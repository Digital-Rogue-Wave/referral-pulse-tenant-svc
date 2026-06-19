# ReferralAI — Database Tables per Microservice

**Derived from:** System Architecture v1, API Contract v1.2, Event Model v2.1, Product Spec v3.2, Responsibility Contract v2, Failure & Observability Model v2  
**Status:** Working hypothesis — subject to implementation discovery  
**Date:** February 2026

---

## Overview

The platform uses **per-service PostgreSQL databases** (AWS RDS) for operational data, **ClickHouse** for analytics OLAP, and **Redis (ElastiCache)** for caching, dedup, and real-time counters. The Event Ingestion Service is the only service with **no RDS** — it uses Redis exclusively.

---

## 1. Identity & Access Service — `identity_db`

Wraps Ory Kratos/Keto/Hydra. Some tables are managed by Ory internally; the service adds platform-specific tables on top.

| Table | Purpose | Key Columns | Notes |
|-------|---------|-------------|-------|
| `tenants` | Tenant (company) records | `id` (ULID), `name`, `plan`, `status`, `verification_status`, `created_at`, `metadata` | One program per tenant. Tenant isolation root. |
| `users` | Platform user accounts (operators) | `id` (ULID), `tenant_id` (FK), `email`, `name`, `role`, `kratos_identity_id`, `created_at`, `last_login_at` | Role: Owner / Admin / Operator / Viewer. Ory Kratos manages credentials. |
| `roles` | Role definitions | `id`, `name`, `scopes` (JSON array), `description` | Maps to OAuth2 scopes (`programs:read`, `campaigns:write`, etc.) |
| `user_roles` | User-to-role assignments | `user_id` (FK), `role_id` (FK), `tenant_id` (FK), `assigned_at`, `assigned_by` | Per-tenant role assignment. |
| `api_keys` | API key records | `id` (ULID), `tenant_id` (FK), `key_hash` (bcrypt), `key_prefix` (last 4 chars), `key_type` (`secret` / `publishable`), `label`, `scopes`, `created_at`, `revoked_at`, `created_by` | Full key value returned once at creation, never again. Only `key_prefix` in logs/dashboards. |
| `oauth2_clients` | OAuth2 client registrations | `id`, `tenant_id` (FK), `client_id`, `client_secret_hash`, `redirect_uris`, `grant_types`, `scopes`, `created_at` | Managed via Ory Hydra. Dashboard SPA + API clients. |
| `sessions` | Active session records | `id`, `user_id` (FK), `token_hash`, `expires_at`, `created_at`, `ip_hash`, `user_agent` | Managed via Ory Kratos. |

**Ory-managed tables (not directly owned but in same DB cluster):** Kratos identity tables, Keto relation tuples, Hydra OAuth2 tables.

---

## 2. Program & Campaign Service — `campaign_db`

| Table | Purpose | Key Columns | Notes |
|-------|---------|-------------|-------|
| `programs` | Top-level program container | `id` (ULID), `tenant_id` (FK), `name`, `status` (`active` / `paused` / `archived`), `default_attribution_model`, `default_attribution_window_days`, `created_at`, `updated_at`, `metadata` | One program per tenant. |
| `campaigns` | Referral campaigns | `id` (ULID), `program_id` (FK), `tenant_id` (FK), `name`, `slug`, `pulse_type` (enum), `status` (`draft` / `active` / `paused` / `completed` / `archived`), `enrollment_model` (`open` / `selective`), `start_date`, `end_date`, `budget_amount`, `budget_currency`, `created_at`, `updated_at`, `metadata` | Pulse type shared across all variants. |
| `variants` | Campaign variants (segment-specific config) | `id` (ULID), `campaign_id` (FK), `tenant_id` (FK), `name`, `is_default` (bool), `priority`, `allocation_weight`, `segment_id` (FK, nullable), `inline_segment_rules` (JSON, nullable), `reward_config` (JSON), `messaging` (JSON), `eligibility_rules` (JSON array), `enabled` (bool), `created_at`, `updated_at`, `metadata` | Every campaign has at least one default variant. `reward_config` follows the Reward Configuration schema from API Contract §3.3. |
| `pulses` | Workflow templates | `id` (ULID), `tenant_id` (FK), `name`, `trigger_event_type`, `conversion_event_type`, `workflow_definition` (JSON), `created_at`, `metadata` | Defines the trigger logic for campaigns (Signup Pulse, Conversion Pulse, etc.). |
| `playbooks` | Vertical-specific bundles | `id` (ULID), `name`, `vertical` (enum: `b2b_saas`, `agency`, `creator`, `ai_tool`), `recommended_pulses` (JSON), `default_reward_config` (JSON), `default_messaging` (JSON), `created_at` | Pre-configured templates. Platform-level (not tenant-scoped). |
| `referral_code_registry` | Referral code → campaign mapping | `referral_code` (PK), `campaign_id` (FK), `variant_id` (FK), `participant_id`, `tenant_id` (FK), `created_at`, `expires_at` | Used by Event Ingestion Service to resolve codes at ingestion time. Synced to Redis cache. |

---

## 3. Segmentation & Eligibility Service — `segmentation_db`

| Table | Purpose | Key Columns | Notes |
|-------|---------|-------------|-------|
| `segments` | Segment definitions | `id` (ULID), `tenant_id` (FK), `name`, `type` (`attribute_based` / `behavioral` / `random` / `ai_generated`), `rules` (JSON), `hash_seed` (for random segments), `created_at`, `updated_at`, `metadata` | Random segments use `SHA256(actor_id + campaign_id) mod 100`. |
| `segment_members` | Segment membership records | `segment_id` (FK), `participant_id`, `tenant_id` (FK), `added_at`, `removed_at`, `source` (`rule_evaluation` / `ai_suggestion` / `manual`) | Set operation — adding already-present member is a no-op (idempotent). |
| `eligibility_rules` | Reusable eligibility rule definitions | `id` (ULID), `tenant_id` (FK), `name`, `checkpoint` (enum: `campaign_entry` / `referral_creation` / `conversion_validation` / `reward_approval` / `payout`), `rule_definition` (JSON), `created_at` | Eligibility Chain evaluates at five checkpoints. |
| `eligibility_evaluations` | Evaluation audit log | `id` (ULID), `tenant_id` (FK), `participant_id`, `campaign_id`, `variant_id`, `checkpoint`, `result` (`pass` / `fail`), `failed_rule_id`, `evaluated_at` | Cached in Redis for 5 min. |

**Redis usage:** Real-time eligibility check cache, hash-based variant assignment cache.

---

## 4. Event Ingestion Service — **No RDS**

This service is a stateless gateway. It owns nothing persistent.

| Store | Purpose | Key Patterns | Notes |
|-------|---------|--------------|-------|
| **Redis: dedup cache** | Event deduplication | `dedup:{tenant_id}:{external_id}` (TTL 90 days) | Prevents duplicate event processing. |
| **Redis: rate limit counters** | Per-key rate limiting | `ratelimit:{api_key_prefix}:{window}` | Per API Contract §7.4 rate limits. |
| **Redis: active campaign cache** | Campaign availability check | `campaign:active:{tenant_id}:{campaign_id}` | Refreshed on `campaign.activated/paused/completed` events. |
| **Redis: touch dedup** | Secondary touch dedup | `touchdedup:{referral_code}:{session_id}:{timestamp_bucket_5min}` | Prevents duplicate touch events within 5-min window. |

---

## 5. Referral Workflow Service — `referral_db`

| Table | Purpose | Key Columns | Notes |
|-------|---------|-------------|-------|
| `referral_links` | Generated referral links | `id` (ULID), `tenant_id` (FK), `referral_code` (unique), `participant_id`, `campaign_id`, `variant_id`, `short_url`, `destination_url`, `cookie_ttl_days`, `status` (`active` / `disabled`), `created_at`, `expires_at` | Variant resolved at link generation time, not at click time. |
| `referrals` | Referral workflow instances | `id` (ULID), `tenant_id` (FK), `referral_code`, `participant_id` (referrer), `referee_id` (nullable), `campaign_id`, `variant_id`, `status` (enum: `created` / `qualified` / `converted` / `rewarded` / `clawed_back` / `rejected` / `expired`), `temporal_workflow_id`, `fraud_score`, `created_at`, `updated_at`, `external_id`, `metadata` | Each referral = Temporal workflow instance. `referral_id + event_type` composite key for idempotency. |
| `participants` | Referrer profiles | `id` (ULID), `tenant_id` (FK), `email`, `email_hash`, `name`, `external_id` (client's identifier), `lifecycle_state` (enum: `candidate` / `active` / `dormant` / `reactivated` / `flagged` / `suspended` / `banned`), `trust_tier` (enum: `unknown` / `new` / `trusted` / `ambassador`), `trust_score` (0–100), `tags` (JSON array), `attributes` (JSON), `created_at`, `updated_at`, `blocked_at`, `metadata` | Trust score from 5 components: Account Age (15%), Success Rate (25%), Conversion Quality (20%), Fraud Incidents (25%), Verification (15%). |
| `referees` | Referee profiles | `id` (ULID), `tenant_id` (FK), `email`, `email_hash`, `external_id` (client's referee ID), `anonymous_id`, `first_seen_at`, `identified_at`, `created_at`, `metadata` | Progressive identification: anonymous → email → external ID. |
| `identity_stitching` | Session-to-identity mappings | `id` (ULID), `tenant_id` (FK), `session_id`, `anonymous_id`, `referee_id` (nullable), `referral_code`, `stitched_at`, `stitch_method` (`session_based` / `code_based` / `email_based`) | Links anonymous pre-identification events to identified referees for attribution. |
| `touches` | Touch event records | `id` (ULID), `tenant_id` (FK), `referral_id` (FK, nullable), `referral_code`, `event_type` (enum: `link_clicked` / `page_viewed` / `widget_interaction` / `share` / `email_opened` / `email_link_clicked`), `session_id`, `anonymous_id`, `click_id`, `ip_hash`, `user_agent`, `geo_country`, `geo_city`, `touch_sequence_number`, `occurred_at`, `consent_status`, `metadata` | Append-only. `touch_sequence_number` enables sequence models for AI attribution. |
| `participant_enrollments` | Participant-to-campaign enrollment records | `participant_id` (FK), `campaign_id` (FK), `variant_id` (FK), `tenant_id` (FK), `enrollment_method` (enum: `api_single` / `api_bulk` / `csv_import` / `crm_connector` / `auto_rule` / `sdk_widget`), `enrolled_at` | Tracks which campaigns a participant is enrolled in. |

**Redis usage:** Hot referral state lookup, session mapping cache.

---

## 6. Reward & Payout Service — `reward_db`

| Table | Purpose | Key Columns | Notes |
|-------|---------|-------------|-------|
| `rewards` | Reward instances | `id` (ULID), `tenant_id` (FK), `referral_id`, `participant_id` (referrer), `campaign_id`, `variant_id`, `recipient_type` (`referrer` / `referee`), `reward_type` (enum: `flat_cash` / `percentage` / `discount_percentage` / `discount_fixed` / `credit` / `non_monetary` / `revenue_share` / `milestone` / `leaderboard`), `amount` (minor units), `currency`, `status` (enum: `earned` / `pending_approval` / `approved` / `rejected` / `fulfillment_initiated` / `fulfilled` / `clawed_back`), `approval_mode_used`, `approved_by`, `fraud_score_at_approval`, `fulfilled_at`, `created_at`, `updated_at`, `metadata` | `referral_id + event_type` composite key for idempotency. `fraud_score_at_approval` creates labeled training data for ML. |
| `cap_ledgers` | Per-referrer and per-campaign cap counters | `id` (ULID), `tenant_id` (FK), `participant_id` (nullable), `campaign_id` (nullable), `program_id` (nullable), `cap_type` (`per_referrer` / `per_campaign` / `per_program`), `cap_period` (`day` / `week` / `month` / `campaign_lifetime`), `period_start`, `current_count`, `max_count`, `current_amount`, `max_amount` | Atomic enforcement via PostgreSQL advisory locks. |
| `clawbacks` | Clawback audit records | `id` (ULID), `tenant_id` (FK), `reward_id` (FK), `referral_id`, `clawback_reason` (required), `clawback_amount` (minor units), `currency`, `initiated_by_type` (`system_auto` / `operator`), `initiated_by_id`, `created_at` | Immutable correction events. Reason is mandatory per API Contract §3.8. |
| `payouts` | Payout batch records | `id` (ULID), `tenant_id` (FK), `status` (enum: `pending` / `processing` / `completed` / `partially_failed` / `failed`), `fulfillment_method` (enum: `stripe_connect` / `paypal` / `bank_transfer` / `sepa` / `gift_card` / `credit`), `total_amount`, `currency`, `item_count`, `description`, `confirmed_at`, `completed_at`, `created_at`, `metadata` | Two-step process: create → confirm. |
| `payout_items` | Individual payout line items | `id` (ULID), `payout_id` (FK), `tenant_id` (FK), `participant_id`, `reward_id` (FK), `amount` (minor units), `currency`, `status` (`pending` / `completed` / `failed`), `external_transfer_id`, `failure_reason` | Links individual rewards to payout batches. |

---

## 7. Analytics & Attribution Service — `analytics_db` + ClickHouse

### PostgreSQL (`analytics_db`)

| Table | Purpose | Key Columns | Notes |
|-------|---------|-------------|-------|
| `attribution_records` | Immutable attribution results | `id` (ULID), `tenant_id` (FK), `referral_id`, `conversion_event_id`, `model_used` (enum: `first_touch` / `last_touch` / `linear` / `time_decay` / `position_based` / `ai_weighted`), `window_days`, `total_attributed_revenue` (minor units), `currency`, `confidence` (0–1, for AI-weighted), `computed_at` | Immutable record: participant → referral → conversion → revenue. |
| `attribution_touches` | Touch credit allocations | `id` (ULID), `attribution_record_id` (FK), `touch_id`, `participant_id`, `channel`, `credit_weight` (decimal 0–1), `occurred_at` | Per-touch credit in multi-touch models. |
| `kpi_snapshots` | Computed KPI snapshots | `id` (ULID), `tenant_id` (FK), `program_id`, `campaign_id` (nullable), `variant_id` (nullable), `kpi_type`, `value`, `period_start`, `period_end`, `computed_at` | Periodic KPI computations for dashboard. |
| `experiment_results` | Variant comparison statistical results | `id` (ULID), `tenant_id` (FK), `campaign_id`, `variant_a_id`, `variant_b_id`, `metric`, `significance_level`, `p_value`, `power`, `sample_size_a`, `sample_size_b`, `conclusion` (`significant` / `not_significant` / `insufficient_data`), `computed_at` | Sequential testing: α=0.05, power=0.80 with early stopping. |

### ClickHouse (OLAP)

| Table | Purpose | Engine | Key Columns | Notes |
|-------|---------|--------|-------------|-------|
| `events` | All domain events (wide table) | `ReplacingMergeTree` | `event_id` (dedup key), `tenant_id`, `event_type`, `event_name`, `actor_id`, `actor_type`, `occurred_at`, `attribution_context` (nested), `properties` (flat JSON), `revenue.*` sub-columns | Ordered by `(tenant_id, event_type, event_id)`. Batch insert every 5 sec / 1000 events. 5–30s eventual consistency. |
| `touches_analytics` | Touch-specific denormalized view | Materialized View | `tenant_id`, `campaign_id`, `variant_id`, `participant_id`, `touch_type`, `channel`, `geo_country`, `occurred_at` | Powers funnel analytics and channel performance. |
| `conversions_analytics` | Conversion-specific denormalized view | Materialized View | `tenant_id`, `campaign_id`, `variant_id`, `conversion_type`, `revenue_amount`, `mrr`, `arr`, `ltv_estimate`, `occurred_at` | Powers revenue attribution dashboards. |
| `referrer_activity` | Referrer-level activity aggregates | Materialized View | `tenant_id`, `participant_id`, `campaign_id`, `total_touches`, `total_conversions`, `total_revenue`, `last_activity_at` | Powers referrer performance views. |

**Redis usage:** Real-time counters for active campaigns (conversion count, reward spend, referrer activity). Bridges the gap while ClickHouse catches up.

---

## 8. Notification & Webhook Service — `notification_db`

| Table | Purpose | Key Columns | Notes |
|-------|---------|-------------|-------|
| `webhook_endpoints` | Webhook configuration | `id` (ULID), `tenant_id` (FK), `url`, `secret` (for HMAC-SHA256 signing), `api_version` (locked to prevent breaking changes), `event_filters` (JSON array, supports wildcards: `referral.*`, `reward.*`, `*`), `status` (`active` / `disabled`), `consecutive_failures`, `created_at`, `updated_at` | Auto-disabled after 50 consecutive failures with owner notification. |
| `webhook_deliveries` | Delivery log | `id` (ULID), `webhook_endpoint_id` (FK), `tenant_id` (FK), `event_id`, `event_type`, `status` (`pending` / `delivered` / `failed`), `http_status_code`, `attempt_count`, `next_retry_at`, `last_attempted_at`, `delivered_at`, `error_message` | `event_id + webhook_id` composite key for dedup. Retry: 1m → 5m → 30m → 2h → 12h → 24h (7 attempts). |
| `notification_templates` | Email notification templates | `id` (ULID), `tenant_id` (FK, nullable — platform templates have no tenant), `template_type` (enum: `reward_earned` / `reward_fulfilled` / `campaign_activated` / `fraud_alert` / `payout_completed` / etc.), `subject_template`, `body_template`, `channel` (`email` / `in_app`), `created_at`, `updated_at` | Transactional email via AWS SES. |
| `notification_deliveries` | Email/in-app delivery log | `id` (ULID), `tenant_id` (FK), `template_id` (FK), `recipient_email`, `recipient_id`, `channel`, `status` (`sent` / `delivered` / `bounced` / `failed`), `sent_at`, `metadata` | Tracks all outbound communications. |
| `endpoint_health` | Webhook endpoint health state | `webhook_endpoint_id` (FK), `tenant_id` (FK), `consecutive_failures`, `last_success_at`, `last_failure_at`, `auto_disabled_at`, `owner_notified_at` | Drives auto-disable logic and health dashboard. |

---

## 9. AI Intelligence Service — `ai_db`

| Table | Purpose | Key Columns | Notes |
|-------|---------|-------------|-------|
| `ai_decision_logs` | All AI decisions audit trail | `id` (ULID), `tenant_id` (FK), `decision_type` (enum: `fraud_score` / `recommendation` / `insight` / `segment_suggestion` / `health_score`), `tier` (`A` / `B` / `C`), `model_used`, `prompt_version_id` (FK), `input_context` (JSON, max 8000 tokens), `output` (JSON), `reasoning_chain` (text), `latency_ms`, `token_count`, `cost_estimate`, `created_at` | Single source of truth for "what did AI do, when, and why." Retained 24 months. |
| `prompt_versions` | Prompt template versioning | `id` (ULID), `prompt_name`, `version`, `template` (text), `model_target`, `is_active` (bool), `created_at`, `created_by` | Retained indefinitely. Enables A/B testing of prompts. |
| `recommendations` | AI recommendation records | `id` (ULID), `tenant_id` (FK), `recommendation_type` (enum: `campaign_setup` / `optimization` / `segmentation` / `incentive`), `payload` (JSON), `status` (`pending` / `accepted` / `rejected` / `expired`), `accepted_by`, `accepted_at`, `rejected_reason`, `created_at`, `expires_at` | AI outputs are suggestions, not commands. Operators accept/reject. |
| `fraud_rules` | Fraud detection rule configurations | `id` (ULID), `tenant_id` (FK, nullable — platform-level rules), `rule_name`, `signal_type`, `condition` (JSON), `auto_action` (enum: `reward_held` / `participant_flagged` / `auto_blocked` / `none`), `threshold`, `enabled` (bool), `created_at` | Tier A deterministic rules. Zero LLM cost. |
| `fraud_reviews` | Fraud review queue | `id` (ULID), `tenant_id` (FK), `participant_id`, `signal_type`, `severity`, `evidence` (JSON), `fraud_report` (JSON, reasoning chain), `review_status` (`pending` / `approved` / `rejected` / `banned`), `reviewed_by`, `reviewed_at`, `temporal_workflow_id`, `created_at` | Human-in-the-loop. Only humans can ban. |
| `model_artifacts` | ML model metadata | `id` (ULID), `model_type` (enum: `fraud_ml` / `propensity` / `attribution_ai`), `version`, `s3_path`, `training_dataset_description`, `performance_metrics` (JSON), `is_active` (bool), `created_at` | Weights stored in S3. Metadata here. No PII in training. |

**Redis usage:** Inference caching (cached fraud scores per referrer, TTL 5 min), `event_id` deduplication (TTL 24h).

---

## Summary Matrix

| # | Service | Database | Tables | Redis | ClickHouse |
|---|---------|----------|--------|-------|------------|
| 1 | Identity & Access | `identity_db` | ~7 + Ory tables | Sessions | — |
| 2 | Program & Campaign | `campaign_db` | 6 | — | — |
| 3 | Segmentation & Eligibility | `segmentation_db` | 4 | Eligibility cache, variant assignment | — |
| 4 | Event Ingestion | **None** | 0 | Dedup, rate limits, campaign cache, touch dedup | — |
| 5 | Referral Workflow | `referral_db` | 6 | Hot referral state, session mappings | — |
| 6 | Reward & Payout | `reward_db` | 5 | — | — |
| 7 | Analytics & Attribution | `analytics_db` | 4 | Real-time counters | `events` + 3 materialized views |
| 8 | Notification & Webhook | `notification_db` | 5 | — | — |
| 9 | AI Intelligence | `ai_db` | 6 | Inference cache, event dedup | Reads for batch queries |

**Total:** 8 PostgreSQL databases, ~43 tables, 1 ClickHouse instance with 4 tables/views, Redis shared across 6 services.

---

> **Note:** Table schemas are derived from the domain model, API contracts, and event model. Exact column names and types are working hypotheses that will be finalized during implementation. Ory-managed tables (Kratos, Keto, Hydra) are excluded from the count as they follow Ory's internal schema.
