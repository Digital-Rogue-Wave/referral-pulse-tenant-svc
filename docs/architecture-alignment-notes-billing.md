# Architecture Alignment Notes – Billing (Discussion)

This file records proposed clarifications/deltas between the project’s source-of-truth architecture (`docs/specs/microservices-architecture.md`) and the current tenant-svc billing implementation.

It is intended for discussion and approval (e.g. with the project architect) and does not modify the source-of-truth architecture document.

---

## 1) Endpoint namespace: `/tenants/:id/*` vs `/v1/billings/*`

### Current implementation decision
- Tenant-scoped billing APIs are exposed under `/v1/billings/*`.
- Tenant context is derived from `tenant-id` header / CLS (not from URL tenant id).

### Auth / context assumption
- Per architecture, all authenticated requests flow through Ory (Hydra) + Keto authorization, so `tenant-id` is expected to be available in request context for all non-public routes.

### Why
- Keeps billing boundaries clean and makes a future extraction into a dedicated billing microservice easier.
- Avoids spreading billing logic across tenant controllers.

### Risks / questions
- If the architecture requires external URLs to remain `/tenants/:id/*`, we may need lightweight route aliases (forwarders) later.

### Proposal
- Confirm that `/v1/billings/*` is the intended canonical contract for billing APIs.
- If the architecture insists on `/tenants/:id/*`, implement compatibility route aliases that delegate to billing handlers (without moving business logic out of billing).

---

## 2) Missing internal endpoint: `GET /internal/tenants/:id/status`

### Architecture intent
- Other services should be able to quickly determine whether a tenant is allowed to perform actions (payment enforcement / account state).

### Current state
- Not implemented in tenant-svc.

### Proposal
- Implement `GET /internal/tenants/:id/status` guarded by service-to-service auth.
- Response shape should be explicitly defined (example):
  - `tenantId`
  - `status` (`active|suspended|locked`)
  - `paymentStatus` (architecture state machine: `active|past_due|restricted|locked`)
  - `subscriptionStatus` (from `BillingEntity.status`)
  - `plan` (from billing plan)
  - Optional: `trialEndsAt`

---

## 3) `payment_status` state machine mismatch

### Architecture intent
- `payment_status`: `active | past_due | restricted | locked`.
- Escalation windows (0–7d, 7–21d, 21d+) with differing product access.

### Current state
- `tenant.paymentStatus`: `pending | completed | failed`.
- Separate `tenant.status` handles security suspend/lock.

### Impact
- Cross-service enforcement semantics are simpler today and may not express “restricted but still tracking-enabled” states.

### Required direction
- Full alignment is required: extend `PaymentStatusEnum`, add migration, and update guards + webhook handlers to implement `active/past_due/restricted/locked`.
- Any escalation timing (0–7d, 7–21d, 21d+) should be represented in persisted state and/or a deterministic transition mechanism (scheduled job) so all services observe consistent behavior.

---

## 4) Enterprise-level enforcement boundaries

### Intended pattern
- Enforcement happens at service boundaries:
  - Local guards for tenant-svc routes.
  - Other services either:
    - Call internal endpoints to check status/limits before executing, or
    - Publish usage events and rely on tenant-svc to reject increments when limits exceeded.

### Current state
- Usage increment/decrement internal endpoints exist and enforce limits.
- Some cross-service behaviors (campaign pausing, suspension emails) are explicitly out-of-scope in this repo.

### Proposal
- Side effects should be handled via Temporal workflows (with SNS/SQS + DLQ patterns), not inside request handlers:
  - Campaign pausing on suspension/lock/restriction is triggered by events and executed by workflows.
  - Billing-related emails/notifications are executed by workflows.
- Read-only UI is a frontend responsibility:
  - Backend exposes status via internal status endpoint (and optionally response headers for tenant-scoped APIs).
  - Backend enforces write restrictions via guards.

---
