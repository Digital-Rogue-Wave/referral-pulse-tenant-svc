# Lessons Learned

Rules learned from corrections during development sessions.
Reviewed at session start. Updated after every mistake.

<!-- Add rules in imperative form. One line per rule. Date it. -->

## Seed rules (from architecture and codebase patterns)

2026-05-07: NEVER use ULID/UUID as idempotency keys — they are always unique and defeat deduplication. Use business-domain keys: `order-created-${orderId}`, `payment-${transactionId}`.
2026-05-07: Idempotency keys must be deterministic — same operation must produce the same key. Think: "if I retry this, will it generate the same key?"
2026-05-07: No magic fallbacks for idempotency — pass keys explicitly via IPublishOptions, never rely on HTTP context fallback.
2026-05-07: Three deduplication layers: SQS FIFO (5 min), Redis IdempotencyService (24h), DLQ replay tracking (24h). All must use the same business-domain key.
2026-05-07: Use JsonService (simdjson) for all JSON parsing > 1KB — Redis, SQS messages, large HTTP responses. 2-10x faster than native JSON.parse.
2026-05-07: Services NEVER call SideEffectService directly — only listeners can. Emit events via TransactionEventEmitterService.emitAfterCommit().
2026-05-07: No @Cron() decorators — use BullMQ repeatable jobs via QueueService.
2026-05-07: Always use ulid() for entity IDs, never uuid(). But for idempotency keys, use business-domain keys.
2026-05-07: Prisma 7 uses composition pattern — new PrismaClient({ adapter }) with @prisma/adapter-pg.
2026-05-07: tenant_id must be in every WHERE clause. Enforced by TenantAwareService middleware.
