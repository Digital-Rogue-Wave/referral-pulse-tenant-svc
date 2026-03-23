# Git Workflow Rules (Always Active)

## Commits
- Format: `type(scope): description` (conventional commits).
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `ci`.
- Scope: module name or area (`auth`, `orders`, `prisma`, `k8s`).
- Description: imperative mood, lowercase, no period, max 72 chars.
- Examples: `feat(orders): add SQS consumer for payment events`, `fix(auth): handle expired JWT refresh tokens`.

## Branches
- Pattern: `type/TICKET-123-short-description`.
- Examples: `feat/ORD-456-order-cancellation`, `fix/AUTH-789-token-refresh`.
- Always branch from `main` or `develop` (project-specific).

## Before Committing
- Run `pnpm lint` — fix all errors.
- Run `pnpm test` — all tests must pass.
- Run `pnpm build` — must compile without errors.
- Review `git diff --staged` — only intended changes.

## Never Commit
- `.env` files or any file with secrets.
- `node_modules/`, `dist/`, `.prisma/` generated files.
- IDE-specific files (`.idea/`, `.vscode/settings.json`).
- Large binary files or data dumps.
- `console.log` debugging statements.

## PR Guidelines
- One logical change per PR. If it needs a paragraph to explain, split it.
- PR description: what changed, why, how to test.
- Link to ticket/issue.
- Self-review before requesting others.
