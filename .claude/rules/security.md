# Security Guardrails (Always Active)

Detailed checklists are in `reference/nestjs-review-checklist.md`. These are non-negotiable:

- NEVER hardcode secrets, API keys, tokens, or connection strings. Use ConfigModule + env vars.
- ALL external input validated at controller boundary (class-validator DTOs).
- Every non-public endpoint MUST have auth guard. Mutating endpoints MUST check Keto permissions.
- Never log PII at INFO level. Mask sensitive fields in logs.
- Never expose stack traces or internal paths to clients. RFC 9457 ProblemDetail only.
- CORS: explicit origin whitelist. Never `*` in production.
- Run `pnpm audit` before merging. Block on critical/high vulnerabilities.
- GDPR: every model with PII must support deletion/anonymization.
