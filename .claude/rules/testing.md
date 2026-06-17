# Testing Rules (Always Active)

Test pyramid, AAA structure, naming, and test doubles are in `architecture.md`.

## Mandatory
- Every feature, endpoint, and bug fix MUST have tests. No exceptions.
- Implement first, then write thorough tests. No feature ships without coverage.
- Target: 80%+ overall, 100% on critical paths (auth, payments, data mutations).
- Run the full test suite before committing. New code must not decrease coverage.

## Test Types
- **Unit** (`*.spec.ts`): mock dependencies, test business logic in isolation.
- **Integration** (`*.integration.spec.ts`): run against Docker infrastructure (real PostgreSQL, real Redis, real LocalStack). Start infra with `docker compose up -d` in the infra repo.
- **E2E** (`*.e2e-spec.ts`): full HTTP cycle via Supertest against Docker infrastructure.

## Infrastructure for Tests
- Integration and e2e tests connect to the Docker Compose infrastructure (not mocks).
- PostgreSQL, Redis, LocalStack (SQS/SNS/S3), Ory Hydra/Kratos/Keto, Temporal are all real containers.
- Each test suite uses a clean DB schema or transaction rollback for isolation.

## Assertions
- For SQS/SNS: assert on message payload, not just that `publish` was called.
- Use test builders for complex test objects.
- One logical assertion per test. Test both happy path AND error cases.
