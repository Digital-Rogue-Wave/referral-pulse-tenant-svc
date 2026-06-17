# Performance Awareness (Always Active)

Circuit breaker and messaging resilience rules are in `architecture.md`.

- Flag N+1 queries immediately. Use `include`, `select`, or raw query.
- Paginate all list endpoints. Default: 20, max: 100.
- Use `prisma.$transaction()` for multi-step mutations.
- Response time target: p95 < 200ms reads, < 500ms complex.
- Context window: delegate verbose tasks to sub-agents. Use `/compact` proactively.
