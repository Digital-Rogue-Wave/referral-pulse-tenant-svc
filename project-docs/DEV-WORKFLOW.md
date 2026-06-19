# Claude Code Workflow for NestJS Microservice Development

## The Golden Rule

**You are the architect. Claude Code is the builder.**
You make design decisions. Claude executes them within the guardrails you've set.

---

## Phase 0: Session Start Ritual

Every time you open Claude Code on a project:

```
# 1. Verify Claude loaded the config
/agents                    # Should show: architect, planner, code-reviewer,
                           #              security-reviewer, debugger, doc-updater

# 2. Verify MCP servers are connected
/mcp                       # Should show: context7, memory-keeper, postgres, github

# 3. Orient Claude on what you're working on
"I'm working on the order-service. Current task: [TICKET-123] Add order cancellation.
Here's the acceptance criteria: [paste from ticket]

Check memory-keeper for any past decisions related to order cancellation."
```

**Why**: Claude Code doesn't carry state between sessions. Memory Keeper restores it.

---

## Phase 1: Architecture & Design (New Features)

**Trigger**: New microservice, new module, significant API changes, cross-service communication.

```
# Use the architect agent
@architect "Design the order cancellation flow. Requirements:
- User can cancel within 30 minutes of creation
- Must notify payment-service via SQS to trigger refund
- Must update order status atomically
- Must be idempotent (double-cancel = no-op)"
```

**What the architect agent does**:
1. Explores existing code patterns in your project
2. Proposes a design with trade-offs table
3. Saves architectural decisions to its memory for future reference

**Your role**: Review, challenge, approve. Push back if overengineered.

---

## Phase 2: Implementation Planning

**Trigger**: Approved design, or any task touching > 3 files.

```
# Use the planner agent
@planner "Plan implementation for order cancellation based on the architect's design.
Include: Prisma migration, DTOs, service logic, SQS event, tests."
```

**Expected output**: Numbered steps with files, verification, dependencies.

**Your role**: Review the plan. Reorder if needed. Approve.

---

## Phase 3: Implementation

**Trigger**: Approved plan. Now build it step by step.

```
# Work through the plan step by step
"Execute step 1 of the plan: create the Prisma migration"

# For each implementation step, Claude should:
# 1. Implement the logic
# 2. Write tests covering the implementation
# 3. Run tests to verify
# 4. Move to next step
```

**Key workflow**:
```
Step 1: Create migration    → verify: prisma migrate dev succeeds
Step 2: Write DTO + schema  → verify: TypeScript compiles
Step 3: Implement service    → verify: compiles, logic correct
Step 4: Write tests          → verify: all tests pass
Step 5: Refactor if needed   → verify: all tests still pass
Step 6: Repeat for next step
```

**Your role**: Review each step. Ensure tests cover edge cases.

---

## Phase 4: Code Review

**Trigger**: Implementation complete, before committing.

```
# Use the code-reviewer agent
@code-reviewer "Review all changes for the order cancellation feature"
```

**What it checks**: Security, performance, NestJS patterns, test coverage, code style.

**Your role**: Fix critical/warning issues. Consider suggestions.

---

## Phase 5: Security Review

**Trigger**: New public endpoints, auth changes, data handling changes.

```
@security-reviewer "Review the order cancellation endpoint and SQS consumer for security"
```

**Your role**: Fix all critical findings. No exceptions.

---

## Phase 6: Documentation

**Trigger**: After implementation is approved.

```
@doc-updater "Update docs for the order cancellation feature"
```

---

## Phase 7: Commit & Push

```
# Claude can help with the commit
"Stage and commit with a conventional commit message"

# Expected: feat(orders): add order cancellation with SQS refund notification
```

---

## Quick Reference: Common Tasks

### Bug Fix
```
1. "Here's the error: [paste stack trace]"
2. @debugger "Find root cause for this error"
3. "Implement the fix and write tests for it"
4. @code-reviewer "Review the fix"
5. Commit
```

### Add Endpoint
```
1. @planner "Plan a new GET /orders/:id/status endpoint"
2. Step through plan, implement + write tests
3. @code-reviewer + @security-reviewer
4. Commit
```

### Refactor
```
1. @planner "Plan refactoring [module] to [goal]. Zero behavior change."
2. "Run all tests first — confirm baseline is green"
3. Execute plan step by step
4. "Run all tests — confirm still green"
5. @code-reviewer "Review the refactoring"
6. Commit
```

### New Microservice
```
1. @architect "Design the [service-name] microservice. Domain: [description]"
2. Review and approve design
3. @planner "Plan the scaffold: module structure, Docker, k8s, health checks"
4. Execute plan
5. @security-reviewer "Review the new service setup"
```

---

## Context Management Tips

| Situation | Strategy |
|-----------|----------|
| Long implementation session | Use `/compact` to summarize context |
| Multiple areas to research | Spawn parallel sub-agents |
| Large file to analyze | Ask agent to `grep` specific patterns, don't read whole file |
| Complex debugging | Use `@debugger` — keeps verbose logs out of main context |
| Many test runs | Run tests in a sub-agent — output stays in sub-agent context |

### Token Budget Rules of Thumb
- Keep < 10 MCP servers enabled per project
- Keep < 80 tools active
- Use `haiku` for exploration, `sonnet` for implementation
- Delegate verbose tasks to sub-agents (they have their own context)
- Use `/compact` when you notice Claude repeating itself or losing context

---

## Parallel Sessions with Claude Squad

For multi-service or independent tasks, run parallel isolated sessions:

```bash
# Launch Claude Squad TUI
cs

# Or launch individual worktree sessions in separate terminals
claude --worktree feat-order-cancel    # Terminal 1
claude --worktree feat-payment-sqs     # Terminal 2
claude --worktree fix-hydra-refresh    # Terminal 3
```

**When to parallelize**:
- Independent features across different services
- Bug fix + feature work simultaneously
- Research/exploration + implementation

**When NOT to**:
- Tasks that depend on each other's output
- Changes that touch the same files
- When you need to review step-by-step (use sequential instead)

Claude Squad gives you a TUI dashboard: see all sessions, preview output, review diffs, commit — all from one terminal. Agents keep running even when you close the TUI.

---

## Tooling Cheat Sheet

| Tool | What it does | When to use |
|------|-------------|-------------|
| **Context7** | Pulls live docs into context | Any time you need NestJS/Prisma/Ory API details |
| **Memory Keeper** | Persists decisions across sessions | Save/retrieve architecture decisions, past fixes |
| **Superpowers** | Structured brainstorm → plan → execute | Auto-activates on design/planning conversations |
| **Claude Squad** | Parallel session manager | Multi-service work, independent tasks |
| **Worktrees** | Git isolation per session | Built into `architect` and `debugger` agents |

---

## Slash Commands

```
/agents       — Manage sub-agents (view, create, edit)
/compact      — Compress conversation context
/clear        — Start fresh conversation
/cost         — Show token usage
/hooks        — View active hooks
/model        — Switch models mid-conversation
/btw          — Quick side question (answer discarded)
```

---

## WebStorm Integration

Claude Code works in the WebStorm terminal. Tips:

1. **Split terminal**: One pane for Claude Code, one for manual commands
2. **File navigation**: Tell Claude the file path — it reads from project root
3. **Diff review**: Ask Claude to show `git diff` before committing
4. **Test runner**: Use WebStorm's Jest runner for visual test results,
   Claude Code for writing tests
5. **Parallel work**: Use WebStorm's multiple terminal tabs with worktrees

---

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| "Just implement this feature" (vague) | Give acceptance criteria + constraints |
| Let Claude refactor while fixing a bug | "Fix only the bug. Don't refactor." |
| Accept code without tests | "Write tests covering this implementation" |
| Accept 500+ line files | "Split this into focused modules" |
| Skip security review on auth code | Always `@security-reviewer` on auth |
| Keep debugging in main context | `@debugger` — isolated context |
| Read entire large files | `grep` or read specific line ranges |
| Enable all MCP servers | Enable only what this project needs |
