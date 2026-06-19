# Claude Code Configuration — Teammate Onboarding Guide

> **For**: ReferralAI engineering team
> **Last updated**: May 2026
> **Prerequisites**: Claude Code CLI installed, macOS/Linux, Node.js 22+, pnpm 10+

---

## Table of Contents

1. [What This Config Does](#1-what-this-config-does)
2. [One-Time Setup (15 min)](#2-one-time-setup)
3. [Per-Service Setup (5 min per service)](#3-per-service-setup)
4. [Verify Your Installation](#4-verify-your-installation)
5. [Daily Workflow](#5-daily-workflow)
6. [Working Across Services](#6-working-across-services)
7. [Key Commands Reference](#7-key-commands-reference)
8. [Agent Reference](#8-agent-reference)
9. [Context Window Management](#9-context-window-management)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. What This Config Does

This configuration controls how Claude Code writes code for our 9-microservice NestJS platform. It includes:

- **6 specialized agents** that handle architecture, planning, code review, security review, debugging, and documentation
- **18 reference files** with our real production patterns (event-driven side effects, BullMQ jobs, resilience, observability, etc.)
- **3 hooks** that deterministically block bad code (files > 100 lines, `uuid()` usage, destructive bash commands)
- **7 rules** always loaded into every conversation (architecture, security, coding style, testing, git, performance, agent delegation)
- **5 MCP servers** for live documentation, persistent memory, GitHub access, context optimization, and codebase RAG
- **A self-improvement loop** (`tasks/lessons.md`) where corrections become permanent rules

**The key idea**: Claude Code reads our config before writing a single line. It knows our stack (NestJS 11, Prisma 7, Ory Kratos/Hydra/Keto, BullMQ, Temporal, SQS/SNS), our patterns (SideEffectService, AlsAuthInterceptor, BaseException hierarchy), and our rules (Object Calisthenics, SOLID, never guess). When it writes code, it follows our conventions — not generic ones.

---

## 2. One-Time Setup

These steps are done once per machine. They set up user-level defaults and install companion tools.

### 2.1 Get the config archive

```bash
# Get it from the team shared drive / repo
cp /path/to/claude-code-config.tar.gz ~/Downloads/
cd ~/Downloads
tar -xzf claude-code-config.tar.gz
```

### 2.2 User-level CLAUDE.md

This sets your global defaults — applies to all projects, even ones without `.claude/`.

```bash
mkdir -p ~/.claude
cp claude-code-config/user-CLAUDE.md ~/.claude/CLAUDE.md
```

### 2.3 Install MCP servers (global)

```bash
# Context7 — pulls live library docs (NestJS, Prisma, Ory, etc.)
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp

# Memory Keeper — persists decisions across sessions
claude mcp add --scope user memory-keeper -- npx -y mcp-memory-keeper

# Context Mode — reduces context window usage by 98%
claude mcp add --scope user context-mode -- npx -y context-mode

# Code-Graph-RAG — codebase knowledge graph (per-project, see step 3)
npm install -g @er77/code-graph-rag-mcp
```

### 2.4 Install plugins (inside Claude Code)

Open Claude Code in any directory and run:

```
/plugin install superpowers@claude-plugins-official
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### 2.5 Install Claude Squad (optional — for parallel sessions)

```bash
# macOS
brew install claude-squad

# Linux
curl -fsSL https://raw.githubusercontent.com/smtg-ai/claude-squad/main/install.sh | bash
```

---

## 3. Per-Service Setup

Repeat this for each microservice you work on. The config is identical across all 9 services — the only difference is a service-specific section in `CLAUDE.md`.

### 3.1 Copy the config

> **Important**: Start from a fresh `.claude/` directory. If the service already has one, delete it first: `rm -rf .claude` — the config archive contains everything you need.

```bash
# Go to your service root
cd ~/Developer/referralspace/referral-pulse-campaign-svc

# Start fresh
rm -rf .claude

# CLAUDE.md at project root
cp ~/Downloads/claude-code-config/CLAUDE.md ./CLAUDE.md

# .mcp.json at project root (hidden file)
cp ~/Downloads/claude-code-config/.mcp.json ./.mcp.json

# .claude directory — agents, rules, skills, hooks, settings
cp -r ~/Downloads/claude-code-config/.claude ./.claude

# tasks directory — self-improvement loop
mkdir -p tasks
cp ~/Downloads/claude-code-config/tasks/lessons.md tasks/lessons.md

# docs directory — business context
mkdir -p docs
cp ~/Downloads/claude-code-config/docs/* docs/
```

### 3.2 Edit `.mcp.json`

```bash
vi .mcp.json
# Set GITHUB_PERSONAL_ACCESS_TOKEN to your GitHub PAT
```

### 3.3 Add service-specific section to CLAUDE.md

Edit `CLAUDE.md` and add this block right after the `# CLAUDE.md` header, **before** the principles section. Replace with your service's details:

```markdown
## This Service: campaign-service
- **Owns**: Programs, Campaigns, Variants, Pulses, Playbooks
- **Does NOT own**: Referrals, Rewards, Segments, AI recommendations
- **DB**: campaign_db
- **Publishes**: campaign.activated, campaign.paused, campaign.completed, variant.*
- **Consumes**: ai.recommendation_generated, analytics.goal_reached
- **Sync calls made**: None outbound. Receives: GET /internal/variants/{id}/reward-config from Reward Service
```

Service ownership reference:

| Service | Owns | DB |
|---------|------|-----|
| `tenant-service` | Users, roles, API keys, Ory stack | tenant_db |
| `campaign-service` | Programs, campaigns, variants, pulses, playbooks | campaign_db |
| `segmentation-service` | Segments, eligibility rules, A/B allocation | segmentation_db |
| `ingestion-service` | Nothing persistent (stateless gateway) | Redis only |
| `referral-service` | Referrals, links, profiles, attribution, workflows | referral_db |
| `reward-service` | Rewards, payouts, caps, clawbacks | reward_db |
| `analytics-service` | KPIs, funnels, A/B stats, revenue reporting | analytics_db + ClickHouse |
| `notification-service` | Webhooks, email, delivery retry | notification_db |
| `ai-service` | Fraud scoring, LangChain agents, recommendations | ai_db |

### 3.4 Build the code graph (once per service)

```bash
# Inside the service directory
claude
# Then:
"Run batch_index to build the code graph for this service"
```

Add to `.gitignore`:
```
/.code-graph-rag/
```

### 3.5 Update .gitignore

```bash
echo ".claude/settings.local.json" >> .gitignore
echo "/.code-graph-rag/" >> .gitignore
```

---

## 4. Verify Your Installation

```bash
cd ~/Developer/referralspace/referral-pulse-campaign-svc
claude
```

Inside Claude Code:

```
# Check agents (should show 6)
/agents

# Check MCP servers (should show 5)
/mcp

# Check context usage
/context
```

Expected agents:
```
architect, planner, code-reviewer, security-reviewer, debugger, doc-updater
```

Expected MCP servers:
```
context7, memory-keeper, github, context-mode, code-graph-rag
```

Verify files:

```bash
find .claude -type f | sort
```

Should show:
```
.claude/agents/architect.md
.claude/agents/code-reviewer.md
.claude/agents/debugger.md
.claude/agents/doc-updater.md
.claude/agents/planner.md
.claude/agents/security-reviewer.md
.claude/hooks/post-edit-lint.js
.claude/hooks/validate-bash.js
.claude/hooks/validate-edit.js
.claude/rules/agents.md
.claude/rules/architecture.md
.claude/rules/coding-style.md
.claude/rules/git-workflow.md
.claude/rules/performance.md
.claude/rules/security.md
.claude/rules/testing.md
.claude/settings.json
.claude/skills/nestjs-api/SKILL.md
.claude/skills/nestjs-api/reference/  (18 .md files)
```

Plus at project root:
```
CLAUDE.md
.mcp.json
tasks/lessons.md
docs/  (ARCHITECTURE.md, SPEC.md, BACKLOG.md, API-CONTRACTS.md, DECISIONS.md, docker-compose.yml)
```

---

## 5. Daily Workflow

### 5.1 Start your day (5 min)

**Start infrastructure** (if not already running):

```bash
cd ~/Developer/referralspace/referralai-infra
docker compose up -d
```

**Open your service in WebStorm** and start Claude Code in the terminal:

```bash
cd ~/Developer/referralspace/referral-pulse-campaign-svc
claude
```

**Orient Claude** (do this at every session start):

```
"Review tasks/lessons.md for past corrections.
Check memory-keeper for recent decisions on campaign-service.
Read docs/BACKLOG.md — I'm picking up TICKET-456 today."
```

### 5.2 Feature development (supervised mode)

For any new feature, follow this sequence. Claude stops at each gate and waits for your approval.

```
"Work in SUPERVISED mode for this session.
Stop after each phase and wait for my approval before continuing."
```

**Phase 1 — Clarify the story** (5 min)

```
"Here's the user story for TICKET-456: [paste from BACKLOG.md or ticket]
What's unclear or missing? Don't start designing yet."
```

Answer Claude's questions. This prevents rework later.

**Phase 2 — Architecture** (10 min, skip for small tasks)

```
@architect "Design this feature based on the clarified story.
Read docs/ARCHITECTURE.md section 2.2 for campaign-service context."
```

Review the design. Say `"Approved"` or `"Change X because Y"`.

**Phase 3 — Plan** (5 min)

```
@planner "Plan implementation based on the approved design."
```

Review the numbered plan. Say `"Approved"` or `"Reorder step 3 before step 2"`.

**Phase 4 — Implement** (main work)

```
"Execute step 1"
```

Review the code. Say `"Continue"` or `"Fix X"`.

```
"Execute step 2"
```

Repeat for each step. Hooks enforce rules automatically:
- File > 100 lines → **BLOCKED**
- `uuid()` usage → **WARNED** (use `ulid()`)
- `any` type → **BLOCKED**
- `console.log` → **WARNED** (use Logger)
- After each file write → ESLint runs automatically

**Phase 5 — Code review** (5 min)

```
@code-reviewer "Review all changes for this feature"
```

Fix any Critical or Warning findings.

**Phase 6 — Security review** (only for auth/public endpoints)

```
@security-reviewer "Review the new endpoint for security"
```

**Phase 7 — Tests** (15 min)

```
"Write unit tests for the new service method.
Write e2e tests for the new endpoint.
Run pnpm test && pnpm test:e2e"
```

Integration and e2e tests run against the Docker infrastructure (real PostgreSQL, Redis, LocalStack, Ory, Temporal).

**Phase 8 — Commit** (2 min)

```
"Run pnpm lint && pnpm format"
"Stage all changes and commit with a conventional commit message"
```

Claude generates: `feat(campaigns): add campaign pause with scheduled resume via BullMQ`

The bash hook blocks `git push origin main` — use a feature branch.

### 5.3 End your day (2 min)

```
"Save to memory-keeper:
- TICKET-456: implemented campaign pause with scheduled resume
- Used BullMQ delayed job for scheduled resume
- SideEffectService with critical:false for notification"

"Should anything be added to tasks/lessons.md from today's work?"
```

### 5.4 Quick tasks

**Bug fix** (30 min):

```
"Here's the error: [paste stack trace]"
@debugger "Find root cause"
"Fix it and write a regression test"
@code-reviewer "Review the fix"
"Commit"
```

**New endpoint on existing module** (1 hour):

```
"Story: [paste]. Clarify first."
@planner "Plan this endpoint"
# Implement step by step
@code-reviewer
"Write tests"
"Commit"
```

### 5.5 Autonomous mode (when you trust the task)

For simple, well-defined tasks:

```
"Work in AUTONOMOUS mode.
Implement the plan, write tests, run lint, and show me the final diff."
```

Claude runs through everything and presents the result for your review. Hooks still enforce all rules.

---

## 6. Working Across Services

### One WebStorm window per service

Each service gets its own WebStorm window and its own Claude Code session:

```
Window 1: campaign-service    → Terminal: claude
Window 2: reward-service      → Terminal: claude
```

### Cross-service features

When a feature spans 2+ services (e.g., campaign activation notifies ingestion-service):

1. **Design once**: Use `@architect` in the first service to design the cross-service contract.
2. **Document the contract**: Update `docs/API-CONTRACTS.md` with the event schema.
3. **Implement each side independently**: Each service reads the same `docs/API-CONTRACTS.md`.

```
# Window 1: campaign-service
"Working on campaign-service. TICKET-789: campaign activation must notify ingestion-service.
Read docs/API-CONTRACTS.md for the campaign.activated event schema."

# Window 2: ingestion-service
"Working on ingestion-service. Consuming campaign.activated events from TICKET-789.
Read docs/API-CONTRACTS.md for the event schema."
```

### Parallel sessions with Claude Squad

For independent tasks on different services:

```bash
cs    # Launch the TUI — see all sessions, preview diffs, commit from any
```

Or manually:

```bash
# Terminal 1
claude --worktree feat-campaign-pause

# Terminal 2
claude --worktree feat-reward-clawback
```

---

## 7. Key Commands Reference

### Claude Code slash commands

| Command | Purpose |
|---------|---------|
| `/agents` | List active agents |
| `/mcp` | List MCP servers and their status |
| `/context` | Show context window usage breakdown |
| `/cost` | Show token usage for session |
| `/compact` | Compress conversation to free context |
| `/clear` | Start fresh conversation (loses context) |
| `/model` | Switch model mid-conversation |

### Agent invocations

| Command | When to use |
|---------|-------------|
| `@architect "..."` | New service, new module, cross-service design, significant API changes |
| `@planner "..."` | Any task touching > 2 files |
| `@code-reviewer "..."` | Before every commit |
| `@security-reviewer "..."` | New public endpoints, auth changes, data handling changes |
| `@debugger "..."` | Errors, stack traces, test failures |
| `@doc-updater "..."` | After features land |

### Project commands

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies |
| `pnpm build` | Compile TypeScript |
| `pnpm start:dev` | Development with watch mode |
| `pnpm test` | Run unit tests (Jest) |
| `pnpm test:e2e` | Run e2e tests |
| `pnpm test:cov` | Run tests with coverage |
| `pnpm lint` | ESLint fix |
| `pnpm format` | Prettier format |

---

## 8. Agent Reference

| Agent | Model | What it does | Special capabilities |
|-------|-------|-------------|---------------------|
| **architect** | opus (strongest) | System design, trade-off analysis, service boundaries | Runs in isolated worktree, has project memory |
| **planner** | sonnet | Breaks work into numbered steps with verification | Has project memory |
| **code-reviewer** | sonnet | Reviews diffs for quality, security, patterns | Has project memory |
| **security-reviewer** | opus (strongest) | Ory-specific security checklist (Kratos/Hydra/Keto) | Has project memory |
| **debugger** | sonnet | Systematic root cause analysis | Runs in isolated worktree, has project memory |
| **doc-updater** | haiku (fastest/cheapest) | Keeps docs in sync with code changes | Has project memory |

All agents:
- Run in their own context window (verbose output doesn't pollute your conversation)
- Have the `nestjs-api` skill preloaded (knows our project patterns)
- Check Memory Keeper for past decisions before proposing new ones
- Use Context7 to verify library APIs before generating code
- **Never guess** — will ask you if information is missing

---

## 9. Context Window Management

Claude Code has a 1M token context window. Quality degrades around 60% capacity.

### What consumes context

| Component | Cost | Loaded when |
|-----------|------|-------------|
| System overhead | ~33K tokens | Always |
| CLAUDE.md + rules | ~2.2K tokens | Always |
| MCP tool definitions | ~3-5K per server | On first use (deferred) |
| SKILL.md | ~400 tokens | When agent spawns |
| Reference files | ~200-1500 per file | When agent reads one |
| File reads | Full file content | When Claude reads a file |
| Test output | Varies (can be large) | When tests run |
| Conversation history | Grows per message | Every turn |

### Rules of thumb

- **Every 30 min**: Run `/context` to check usage
- **At 50% capacity**: Run `/compact` to compress conversation
- **At 60% capacity**: Start a new session — commit work, run `/clear`
- **Long features**: Split into sessions (implement → new session → review + test)
- **Verbose tasks**: Use sub-agents (`@debugger`, `@code-reviewer`) — output stays in their context
- **Don't read whole files**: Tell Claude the file path. If you only need a section, say which section.

### Context Mode helps

Context Mode (installed in step 2.3) compresses MCP tool output by 98%. A session that normally hits the wall at 30 minutes can run for 3 hours.

---

## 10. Troubleshooting

### settings.json schema error

```
$schema: Invalid value. Expected "https://json.schemastore.org/claude-code-settings.json"
```

Fix: Ensure `settings.json` has the correct schema URL. Re-copy from the config archive.

### Agents not showing up

```bash
# Check the files exist
ls .claude/agents/
# Should show 6 .md files
```

If missing, re-copy from archive:
```bash
cp -r ~/Downloads/claude-code-config/.claude/agents .claude/agents
```

### Hooks not firing

```bash
# Check hooks exist and are executable
ls -la .claude/hooks/
chmod +x .claude/hooks/*.js
```

### MCP server not connecting

```bash
# Check MCP status
/mcp

# If a server shows disconnected, try:
/mcp restart context7
```

### Claude generates uuid() instead of ulid()

The hook will warn. If Claude keeps doing it, add to `tasks/lessons.md`:

```
YYYY-MM-DD: Always use ulid() from 'ulid' package. NEVER use uuid(). Architecture mandates ULID for all identifiers.
```

### Claude is guessing APIs or inventing methods

Remind it:

```
"Stop. You're guessing. Use Context7 to verify the current API for [library] before continuing."
```

If this happens repeatedly, add to `tasks/lessons.md`:

```
YYYY-MM-DD: Always verify [library] API via Context7 before writing code. Training data is stale.
```

### Context window full / Claude repeating itself

```
/compact       # Compress conversation
# Or if it's really bad:
/clear         # Start fresh (commit your work first!)
```

### Auto-generated folders appeared after a session

Claude Code sometimes creates `.agent/`, `.agents/`, or extra skill folders during sessions. These are not part of our config. If you see them, start fresh:

```bash
rm -rf .claude
cp -r ~/Downloads/claude-code-config/.claude ./.claude
```

### Hidden files not visible in Finder

Press **Cmd + Shift + .** to toggle hidden file visibility in macOS Finder.

---

## Quick Start Checklist

```
□ Extracted claude-code-config.tar.gz
□ Copied user-CLAUDE.md to ~/.claude/CLAUDE.md
□ Installed MCP servers (context7, memory-keeper, context-mode, code-graph-rag)
□ Installed plugins (superpowers, understand-anything)
□ Copied config to my service (.claude/, CLAUDE.md, .mcp.json, tasks/, docs/)
□ Added service-specific section to CLAUDE.md
□ Set GITHUB_TOKEN in .mcp.json
□ Updated .gitignore
□ Cleaned up old installs
□ Ran /agents (6 agents) and /mcp (5 servers) to verify
□ Started infrastructure: docker compose up -d
□ Ready to work!
```
