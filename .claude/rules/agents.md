# Agent Delegation Rules (Always Active)

## When to Delegate

Use sub-agents proactively to preserve main context and enforce quality.

| Trigger | Agent | Why |
|---------|-------|-----|
| "design this", "how should we structure" | `architect` | Architecture decisions need focused reasoning |
| "plan this", "break this down" | `planner` | Multi-step work needs a plan before code |
| Before any implementation > 3 files | `planner` | Plan first, code second |
| After code changes, before commit | `code-reviewer` | Catch issues before they're committed |
| "fix this bug", error traces | `debugger` | Debugging needs systematic isolation |
| Auth changes, public endpoints | `security-reviewer` | Security requires focused attention |
| After feature completion | `doc-updater` | Keep docs in sync with code |

## Delegation Rules
- Sub-agents work in their own context. Main conversation stays clean.
- Sub-agents return SUMMARIES. Verbose output stays in their context.
- Chain agents when needed: `planner` → implement → `code-reviewer`.
- Run parallel research with multiple sub-agents when tasks are independent.
- Use `haiku` model for exploration, `sonnet` for implementation, `opus` for architecture.

## Session Discipline
- At session start: review `tasks/lessons.md` + check memory-keeper for past decisions.
- Plan mode is the default for any task with 3+ steps.
- If plan goes sideways mid-implementation: STOP → re-plan.
- After any correction: update `tasks/lessons.md` with a rule preventing recurrence.
- Before marking done: verify it works. "Would a staff engineer approve this?"
