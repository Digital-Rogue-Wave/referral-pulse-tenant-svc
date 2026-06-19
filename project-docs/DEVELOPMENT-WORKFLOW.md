# Development Workflow: User Story → Deployment

A practical, step-by-step guide for developing NestJS microservice features using Claude Code with this configuration.

---

## Overview

```
User Story → Clarify → Design → Plan → Implement → Review → Test → Commit → PR → Deploy
               │          │        │        │          │                │        │
            You+Claude  @architect @planner  Claude    @code-reviewer  Jest    Claude
                                            +hooks    @security-rev.  +Super.
```

**Your role**: Architect, decision maker, quality gate.
**Claude's role**: Builder, pattern enforcer, reviewer — within your guardrails.

---

## Phase 0: Session Start (30 seconds)

Every time you open a terminal in WebStorm on a microservice:

```bash
# Start Claude Code
claude

# Verify config loaded
/agents     # 6 agents listed
/mcp        # context7, memory-keeper, github

# Orient Claude
"I'm working on order-service. 
Task: [TICKET-123] — [paste the user story title].
Check memory-keeper for any past decisions about this service."
```

Memory Keeper responds with past context — architectural decisions, naming conventions chosen, patterns used. You skip re-explaining things from previous sessions.

---

## Phase 1: Story Clarification (5 min)

**Before writing any code, make sure the story is clear.**

```
"Here's the user story:

As a tenant admin, I want to cancel an order within 30 minutes 
of creation so that my team can correct mistakes.

Acceptance criteria:
- Cancel only if status is PENDING and created < 30 min ago
- Refund notification sent to payment-service via SQS
- Cancelled orders visible in order history with reason
- API returns 409 if already cancelled, 422 if past 30-min window

What's unclear or missing? Don't start designing yet."
```

Claude will ask clarifying questions — things like:
- Should the 30-min window be configurable per tenant?
- Does "refund notification" mean critical (outbox) or non-critical (direct SQS)?
- Should cancellation emit a domain event for other listeners (audit, analytics)?

**Answer these before moving on.** This is where you save hours of rework.

---

## Phase 2: Architecture (10 min — skip for small tasks)

**When to use**: New module, new inter-service communication, new database model, cross-service change.
**Skip for**: Bug fixes, small endpoint additions, config changes.

```
@architect "Design the order cancellation feature based on this story:
[paste the clarified story with your answers to Claude's questions]

Consider: 
- Where does cancellation logic live in the current order module?
- How does the SQS notification fit the SideEffectService pattern?
- Do we need a new Prisma migration?"
```

The architect agent:
1. Runs in its own context (worktree-isolated)
2. Reads `nestjs-event-driven-side-effects.md` and `nestjs-enterprise-patterns.md` from reference files
3. Checks Memory Keeper for past order-service decisions
4. Uses Context7 to verify current NestJS/Prisma APIs
5. Returns a design with trade-offs table

**Your job**: Review the design. Push back if overcomplicated. Approve or adjust.

Example output you'd get:

```
Design: Order Cancellation

Approach: Add cancelOrder method to existing OrderService.
No new module needed — cancellation is part of the Order bounded context.

Components:
1. Migration: add `cancelledAt`, `cancellationReason` to Order model
2. DTO: CancelOrderDto (reason: string, required)
3. Service: OrderService.cancelOrder() — validates window + status
4. Controller: PATCH /api/v1/orders/:id/cancel
5. Listener: emit 'order.cancelled' → SideEffectService → payment-queue
   critical: false (DLQ fallback acceptable for refund notification)

Trade-offs:
| Approach | Pros | Cons |
|----------|------|------|
| PATCH /orders/:id/cancel | REST-conventional | Extra endpoint |
| PATCH /orders/:id { status: 'cancelled' } | Fewer endpoints | Mixes update + cancel logic |
→ Recommended: dedicated cancel endpoint (cleaner validation, clearer audit trail)
```

---

## Phase 3: Planning (5 min)

**Always plan before implementing anything that touches > 2 files.**

```
@planner "Plan implementation for order cancellation based on the approved design.
[paste or reference the architect's output]"
```

The planner agent:
1. Reads the SKILL.md index for relevant patterns
2. Checks Memory Keeper for implementation patterns used before
3. Returns a numbered, ordered plan with verification steps

Example output:

```
Implementation plan — Order Cancellation (M — 2 hours)

1. Prisma migration
   File: prisma/schema.prisma + new migration
   Verify: pnpm prisma migrate dev succeeds

2. DTO + Zod validation
   Files: src/domains/order/dto/cancel-order.dto.ts
   Verify: TypeScript compiles

3. Service method
   File: src/features/order/order.service.ts (add cancelOrder)
   Verify: pnpm build succeeds
   Depends on: 1

4. Controller endpoint
   File: src/features/order/order.controller.ts (add PATCH cancel)
   Verify: pnpm build succeeds
   Depends on: 2, 3

5. Event + listener
   Files: src/common/events/listeners/payment-service.listener.ts
   Verify: pnpm build succeeds
   Depends on: 3

6. Unit tests
   File: src/features/order/__tests__/order.service.spec.ts
   Verify: pnpm test passes
   Depends on: 3

7. Integration tests
   File: src/features/order/__tests__/order.controller.e2e-spec.ts
   Verify: pnpm test:e2e passes
   Depends on: 4, 5
```

**Your job**: Review the plan. Reorder if needed. Remove unnecessary steps. Approve.

---

## Phase 4: Implementation (the core loop)

Work through the plan step by step. This is where hooks and rules enforce your standards automatically.

### Step-by-step execution

```
"Execute step 1: create the Prisma migration for order cancellation."
```

Claude:
1. Reads `reference/nestjs-conventions.md` (Prisma 7.x rules)
2. Uses Context7 to verify current Prisma migration syntax
3. Modifies `schema.prisma`, runs `pnpm prisma migrate dev`

**What happens behind the scenes:**
- `validate-edit.js` fires on every file write — blocks if > 100 lines, warns on `uuid()`
- `validate-bash.js` fires on every bash command — blocks destructive DB ops
- `post-edit-lint.js` runs ESLint after each `.ts` file change
- If Claude tries to use `uuid()`, the hook catches it → Claude corrects to `ulid()`
- If a file exceeds 100 lines, the hook blocks → Claude splits it

### Continue through the plan

```
"Step 2: create the CancelOrderDto"
```

```
"Step 3: implement cancelOrder in OrderService.
Follow the event-driven pattern — service emits event, listener handles SQS."
```

```
"Step 4: add the PATCH endpoint to OrderController"
```

### When Claude is uncertain

Because of the "never guess" principle, Claude will stop and ask:

```
Claude: "The plan says to emit 'order.cancelled' but I don't see an 
existing OrderCancelledEvent class. Should I:
(a) Create a new OrderCancelledEvent extending BaseDomainEvent
(b) Reuse the existing OrderUpdatedEvent with a status field
I need to check — which pattern does this project use?"
```

This is the system working correctly. Answer, and Claude continues.

### Parallel work (optional)

If steps are independent, use Claude Squad:

```bash
# Terminal 1: Claude works on service + controller (steps 2-4)
claude --worktree feat-cancel-service

# Terminal 2: Claude works on event + listener (step 5)
claude --worktree feat-cancel-events
```

Monitor both from the Claude Squad TUI: `cs`

---

## Phase 5: Code Review (5 min)

After implementation, before writing tests:

```
@code-reviewer "Review all changes for order cancellation feature"
```

The code-reviewer agent:
1. Runs `git diff` to see all changes
2. Checks against architecture.md rules (SOLID, Object Calisthenics, naming)
3. Checks NestJS patterns (thin controllers, service-only logic, repository abstraction)
4. Checks for security issues (missing guards, input validation)
5. Reports findings by severity

Example output:

```
## [Warning] order.service.ts:45 — Method exceeds 10 lines
cancelOrder is 14 lines. Extract validation into a private method.

## [Warning] order.controller.ts:23 — Missing @CheckPermission
PATCH cancel endpoint has @UseGuards(JwtAuthGuard) but no permission check.
Add @CheckPermission('orders:cancel') for Keto authorization.

## [OK] No security issues, no hardcoded secrets, ulid() used correctly.
```

**Fix the warnings, then move on.**

---

## Phase 6: Security Review (5 min — only when needed)

**When to run**: New public endpoint, auth changes, data handling changes, before production deploy.

```
@security-reviewer "Review the order cancellation endpoint for security.
Focus on: auth guards, input validation, error response leakage."
```

The security-reviewer agent:
1. Reads `reference/nestjs-review-checklist.md` (Ory-specific checklist)
2. Checks Keto permission model for the new endpoint
3. Verifies JWT validation, input sanitization, error format
4. Uses Context7 to verify current Ory Hydra/Keto best practices

---

## Phase 7: Testing (15 min)

```
"Write unit tests for OrderService.cancelOrder.
Cover: happy path, already cancelled (409), past 30-min window (422),
order not found (404), event emission."
```

```
"Write e2e tests for PATCH /api/v1/orders/:id/cancel.
Cover: authenticated request, missing auth (401), insufficient permissions (403),
valid cancellation, invalid cancellation, response format."
```

Claude writes tests following architecture.md rules (AAA pattern, descriptive names, no test interdependence). Hooks enforce file limits.

```
"Run all tests: pnpm test && pnpm test:e2e"
```

If tests fail, Claude reads the output and fixes. If it can't figure out why:

```
@debugger "Tests failing with this error: [paste error]"
```

The debugger agent runs in worktree isolation, systematically isolates the issue, checks Memory Keeper for past similar fixes, returns root cause + fix.

---

## Phase 8: Documentation (2 min)

```
@doc-updater "Update documentation for the order cancellation feature"
```

The doc-updater agent:
1. Reads the SKILL.md to understand project structure
2. Finds related docs (README, API docs, .env.example)
3. Updates only what changed — no new docs unless asked
4. Adds cancellation-related env vars to `.env.example` if any

---

## Phase 9: Commit & PR (2 min)

```
"Stage all changes and commit with a conventional commit message"
```

Claude runs:
- `git add` (allowed by settings.json)
- Generates message: `feat(orders): add order cancellation with 30-min window and SQS refund notification`
- `validate-bash.js` blocks if Claude tries to push to main directly

```
"Create a PR with description"
```

Claude uses the GitHub MCP to create the PR with:
- What changed
- Acceptance criteria coverage
- How to test
- Link to ticket

The Stop hook fires: `"Remember: run pnpm test before committing"`

---

## Phase 10: Memory Persistence

After the feature is complete:

```
"Save to memory-keeper:
- Order cancellation uses 30-min configurable window (ORDER_CANCEL_WINDOW_MINUTES)
- Uses SideEffectService with critical:false for payment SQS notification
- OrderCancelledEvent extends BaseDomainEvent
- PATCH /api/v1/orders/:id/cancel with @CheckPermission('orders:cancel')"
```

Next time you or Claude works on order-service, this context is immediately available.

---

## Quick Reference: Common Scenarios

### Bug fix (30 min)

```
1. "Here's the bug: [paste error + stack trace]"
2. @debugger "Find root cause"
3. "Fix it and write a regression test"
4. @code-reviewer "Review the fix"
5. Commit: fix(orders): handle race condition in concurrent cancellation
```

### New endpoint on existing module (1 hour)

```
1. Paste the user story
2. @planner "Plan this endpoint"
3. Implement step by step
4. @code-reviewer
5. Write tests
6. Commit
```

### New module (2-4 hours)

```
1. Paste the user story
2. @architect "Design this module"
3. Review + approve design
4. @planner "Plan implementation"
5. Implement step by step
6. @code-reviewer + @security-reviewer
7. Write tests
8. @doc-updater
9. Commit + PR
```

### New microservice (1-2 days)

```
1. @architect "Design the [service] microservice. Domain: [description]"
2. Review: bounded context, API contract, messaging, data model
3. @planner "Plan the scaffold"
4. Clone template: git clone referral-pulse-svc-template
5. Implement module by module (each follows the "new module" flow)
6. @security-reviewer "Full security review before first deploy"
7. @doc-updater
8. K8s manifests (reference/nestjs-enterprise-infrastructure.md)
9. PR + deploy to staging
```

### Cross-service feature (half day)

```
# Window 1: service A
claude
"Working on order-service. Task: order cancellation emits SQS event."
@architect "Design the cross-service contract for order cancellation → payment refund"
# Implement order-service side

# Window 2: service B  
claude
"Working on payment-service. Task: consume order.cancelled event for refund."
# Implement payment-service side (uses the contract from architect)
```

---

## Anti-Patterns (Don't Do This)

| Anti-pattern | Why it fails | Do this instead |
|---|---|---|
| "Just implement the whole feature" | No plan = random file order, missed edge cases | Always `@planner` first for > 2 files |
| Skipping code review | Bugs and pattern drift accumulate silently | Always `@code-reviewer` before commit |
| Pasting huge files into chat | Eats context window, Claude loses focus | Tell Claude the file path — it reads it |
| "Fix this and also refactor that" | Two goals = neither done well | One task per prompt. Refactor separately |
| Ignoring hook warnings | uuid() and console.log slip into production | Fix every warning before moving on |
| Starting without Memory Keeper check | Re-explain decisions from last session | Always check memory at session start |
| Letting Claude pick the messaging pattern | It might call SQS directly instead of SideEffectService | Reference the architecture rule explicitly |
| Not verifying API docs | Claude invents Prisma 7 APIs from Prisma 5 training data | Context7 first. Always |

---

## Time Budget (Realistic)

| Feature size | Plan | Implement | Review | Test | Total |
|---|---|---|---|---|---|
| Bug fix | — | 15 min | 5 min | 10 min | 30 min |
| Small endpoint | 5 min | 30 min | 5 min | 15 min | ~1 hour |
| New module | 10 min | 1-2 hours | 10 min | 30 min | 2-3 hours |
| New microservice | 30 min | 4-6 hours | 30 min | 1-2 hours | 1-2 days |
| Cross-service | 15 min | 2-3 hours | 15 min | 1 hour | half day |

These assume you're reviewing Claude's output at each step, not rubber-stamping. The review time is where you catch the 20% Claude gets wrong.

---

## Context Window Health

Monitor your context usage throughout a session:

```
/cost          # See token usage
/compact       # Compress when Claude starts repeating itself
```

**Rules of thumb:**
- After 30+ back-and-forth messages: `/compact`
- After implementing 5+ files: consider starting a fresh session for review
- For large features: split into multiple sessions (implementation → review → tests)
- Sub-agents protect your main context — use them for verbose tasks
