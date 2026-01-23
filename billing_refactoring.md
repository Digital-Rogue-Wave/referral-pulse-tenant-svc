# Billing Refactoring Plan (Aligned to Toto Example)

## Source of Truth
- Architecture and conventions must align with `docs/architecture.md` and `docs/specs/*`.
- Follow the `src/toto-exemple` flow and patterns for module layout, transactions, and SNS/SQS side effects.

## Goals
- Refactor the existing `src/billing` module to match the new template structure and `toto-exemple` flow.
- Preserve billing behavior while aligning with new common paths, enums, and event flow.
- Ensure billing logic is portable so it can be moved into a standalone microservice later.
- Enforce transactional consistency: side effects (SNS/SQS/Redis/external IO) are last and rollback-safe.

## Key Constraints (Boss Requirements)
- Follow `toto-exemple` module structure and event flow (SNS/SQS + transactional behavior).
- Redis and external side effects must run at the end of the flow to support rollback/compensation.
- Keep code compatible with the updated common folder conventions and new path aliases.
- Billing module must be easily extractable to another service (minimal coupling, explicit boundaries).
- `docs/specs/*` and `docs/architecture.md` are read-only; leave traceability notes only in this file.
- Do not change existing patterns or functions outside billing; only add needed enums/interfaces/types.

## Reference Points
- `src/toto-exemple/toto.module.ts`, `toto.service.ts`, `toto.consumer.ts`, domain events.
- `src/common/events`, `src/common/messaging`, `src/common/side-effects` (outbox/transactional emitters).
- Current billing module: `src/billing/*` (services, controllers, listeners, queues).

---

## Phase 1: Discovery & Gap Analysis
1. **Inventory Billing Surface**
   - List controllers, services, processors, entities, queues, consumers, and DTOs under `src/billing`.
   - Identify external integrations (Stripe, SNS, SQS, Redis, audit, monitoring, idempotency).

2. **Compare to Toto Example Flow**
   - Document current billing flow vs. `toto.service.ts` (transaction boundaries, side effects ordering).
   - Identify where billing emits events using `EventEmitter2` vs. new transactional emitters.
   - Note where SNS/SQS usage deviates from outbox + side-effect service patterns.

3. **Common Folder Path Alignment**
   - Map old imports (`@mod/common/...`) to new common path layout (e.g., `@app/common/...`).
   - Identify enums and interfaces likely moved/renamed (e.g., billing enums, event interfaces).

4. **Portability Check**
   - Identify tight couplings to other modules (`@mod/tenant`, shared entities, or internal-only services).
   - List required contracts to make billing a standalone service (API DTOs, events, DB schemas).

---

## Phase 2: Target Architecture for Billing (to implement later)
1. **Module Layout (Match Toto)**
   - `billing.module.ts`: mirror `toto.module.ts` with `MessagingModule`, `RedisModule`, `StorageModule` (if needed).
   - Consolidate providers (services, consumers, listeners) and remove legacy module wiring.

2. **Domain Events + Transaction Emitters**
   - Introduce billing domain events (e.g., `billing.subscription.created`, `billing.payment.failed`).
   - Replace direct `EventEmitter2` emissions with `TransactionEventEmitterService.emitAfterCommit`.

3. **Outbox/Side Effects**
   - Replace direct SNS/SQS publish with `SideEffectService` (outbox for critical, direct for non-critical).
   - Ensure `critical` vs `non-critical` is explicit per event type.

4. **Side-Effect Ordering**
   - Update transactional operations to persist DB changes first.
   - Perform Redis cache writes/invalidations after commit (last step).
   - Publish SNS/SQS events after transaction commit (outbox or tx-emitter).

5. **Consumers & Queue Handlers**
   - Standardize SQS consumers using `MessageProcessorService` (toto pattern).
   - Implement idempotency and metrics within consumers.

6. **Portability Guarantees**
   - Move cross-service DTOs and events under `src/domains/billing` or equivalent shared domain location.
   - Keep integration boundaries clean (no direct imports from other services’ internals).

---

## Phase 3: Refactor Tasks (Step-by-Step Checklist)
> No code yet — these are the steps to execute in order.

### 3.1 Structural Alignment
- [ ] Restructure `src/billing` folder to match `toto-exemple` layout patterns.
- [ ] Normalize module wiring with new `@app/common/*` modules and updated providers.
- [ ] Align controllers/services naming and organization to match `toto` style.

### 3.2 Transactional Flow Changes
- [ ] Identify core write paths in BillingService (subscription create/upgrade/cancel, usage updates, payment status changes).
- [ ] Wrap critical write flows in `@Transactional` with explicit ordering.
- [ ] Replace direct SNS/SQS publish with `SideEffectService` (outbox for critical events).
- [ ] Replace direct `EventEmitter2` usage with `TransactionEventEmitterService` for after-commit events.

### 3.3 Redis & Side Effects Ordering
- [ ] Move Redis updates/invalidation to the end of each transactional workflow.
- [ ] Ensure any remote calls (Stripe, external APIs) happen after core DB commit or use compensation strategy.
- [ ] Define rollback/compensation plan for each side effect (esp. Stripe + SQS).

### 3.4 Messaging Consistency (SNS/SQS)
- [ ] Map billing events to SNS topic(s) and SQS queues consistent with `toto` patterns.
- [ ] Normalize event envelopes to match `MessageProcessorService` expectations.
- [ ] Add idempotency keys and deduplication IDs where required.

### 3.5 Updated Common Paths & Enums
- [ ] Replace outdated `@mod/common/*` imports with new locations in `src/common/*`.
- [ ] Re-map billing enums/interfaces to updated definitions or create new ones if missing.
- [ ] Update DTO imports to shared domain locations.

### 3.6 Extractability (Future Microservice Split)
- [ ] Move domain events and DTOs to `src/domains/billing`.
- [ ] Define a minimal public surface (controllers + events) for the billing service.
- [ ] Flag any remaining cross-service dependencies that would block extraction.

### 3.7 Tests & Validation
- [ ] Add/update unit tests for core billing flows after refactor.
- [ ] Add SQS consumer tests for idempotency + message parsing.
- [ ] Validate against architecture conventions in `docs/architecture.md`.

---

## Risks & Mitigations
- **Risk:** Breaking billing workflows due to path changes.
  - Mitigation: Introduce mapping list for all moved enums/classes before code changes.
- **Risk:** Side effects executed before DB commit.
  - Mitigation: Enforce `@Transactional` + `emitAfterCommit` + outbox pattern.
- **Risk:** Tight coupling prevents extraction.
  - Mitigation: Move contracts to `src/domains/billing` and remove internal imports.

---

## Decisions + Notes (Aligned with Architecture)
1. **SNS/SQS naming**: Use exact topic/queue names from `docs/architecture.md`. If a new billing event requires a new topic/queue, document it here as **NOTE: Pending approval** for traceability (do not change architecture docs).
2. **Stripe ordering (enterprise-grade)**: Persist DB state first, then emit transactional events/outbox entries; execute Stripe side effects after commit. Use compensation steps for Stripe failures (e.g., revert billing status, emit failure event) rather than rolling back the DB transaction.
3. **Event taxonomy**: Follow a consistent `billing.*` namespace (e.g., `billing.subscription.created`, `billing.payment.failed`, `billing.usage.threshold_crossed`) aligned to existing platform event types in `docs/architecture.md`. If a new event type is needed, record it here with rationale and consumers (no architecture doc changes).
4. **Common folder paths**: Prefer the current `src/common/*` locations and template patterns used by `toto-exemple`. If an enum or utility is missing, add it under common and note it here for traceability.

> Traceability: every naming or flow decision must reference `docs/architecture.md` and the `toto-exemple` pattern; add explicit notes in this plan when something is newly introduced. Architecture docs remain unchanged.

---

## Deliverables
- Updated `src/billing` module aligned with `toto-exemple` flow.
- Billing domain events + DTOs under shared domain folder.
- Standardized SNS/SQS integration with transactional ordering.
- Refactor checklist completed and validated against architecture docs.
