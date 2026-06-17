# Architecture Rules

## Outbound Messaging (Async)

- **Services NEVER call SideEffectService directly**
- Services emit domain events via `txEventEmitter.emitAfterCommit()`
- Listeners receive events and call `SideEffectService`
- Listeners decide `critical: true` (outbox) or `critical: false` (direct + DLQ) based on business criticality

### Flow

```
Service → emitAfterCommit() → Listener → SideEffectService
                                              ├─ critical: true  → Outbox (guaranteed)
                                              └─ critical: false → Direct + DLQ
```

## Sync HTTP Calls

- Use `HttpClientService` from `@common/http` for all sync external HTTP calls
- Built-in circuit breaker, retries, and timeout handling
- Never use `axios` or `fetch` directly

## Types & Domain Structure

- **`src/types/`** - Technical cross-app types and interfaces (messaging, config, common utilities)
- **`src/domains/<domain>/`** - Domain-specific DTOs, mappers, responses, events, and types

```
src/domains/<domain>/
├── dto/                 # Input DTOs (CreateDto, UpdateDto)
├── mappers/             # Response mappers
├── responses/           # Response classes
├── events/              # Domain events
└── types/               # Domain-specific types (optional)
```

## Clean Code Principles

### KISS, YAGNI, DRY
- **KISS** - Simplest solution that works; question every abstraction
- **YAGNI** - Don't build features until actually needed; avoid "just in case" code
- **DRY with Rule of Three** - Don't extract duplication until you see it 3 times

### Code Quality (Object Calisthenics)
- Methods < 10 lines, Classes < 50 lines, Files < 100 lines
- One level of indentation per method; use early returns instead of `else`
- Wrap primitives in value objects when they have domain meaning
- First-class collections (collection class has no other instance variables)
- One dot per line (Law of Demeter) - avoid `a.getB().getC().getD()`
- Objects should have behavior, not just getters/setters (Tell, Don't Ask)
- No more than 3 instance variables per class → compose smaller objects

### Naming
- Same concept = same name everywhere (consistency - highest priority)
- Domain language, not technical jargon
- Avoid vague names: `data`, `info`, `manager`, `handler`, `processor`, `utils`
- No abbreviations; names must be searchable and pronounceable

### Comments & Formatting
- Only explain WHY, never WHAT or HOW
- Prefer self-documenting code over comments
- Public API first, supporting methods below in order of appearance
- Related code together, blank lines between concepts

### Code Smells to Avoid
- **Long Method/Large Class** - Extract methods/classes
- **Feature Envy** - Method uses another class's data extensively → move method
- **Primitive Obsession** - Use value objects
- **Switch on type** - Replace with polymorphism
- **Speculative Generality** - Delete unused "just in case" abstractions
- **Inappropriate Intimacy** - Classes know too much about each other's internals

### SOLID Principles
- **SRP** - One reason to change per class; if describing with "and", split it
- **OCP** - Add new behavior via new classes, not modifying existing code
- **LSP** - Subtypes must honor parent's contract
- **ISP** - Small focused interfaces; no empty method implementations
- **DIP** - Depend on abstractions; inject implementations

### OO Design
- **Composition over Inheritance** - Prefer composing objects over extending
- **Value Objects** - Immutable, compared by value (Money, Email, Address)
- **Entities** - Have identity, compared by ID (User, Order)
- **Aggregates** - Cluster of objects with single root enforcing invariants
- **Design by Contract** - Methods have preconditions, postconditions, invariants
- **Encapsulation** - Hide internals, expose behavior; no public fields
- **Polymorphism** - Replace type conditionals with interfaces
- Patterns should emerge from refactoring, not forced upfront

### Object Stereotypes
Each class should fit one stereotype:
- **Information Holder** - Knows things (User, Product)
- **Structurer** - Maintains relationships (OrderItems)
- **Service Provider** - Performs work (PaymentProcessor)
- **Coordinator** - Orchestrates workflow (OrderFulfillmentService)
- **Interfacer** - Transforms between systems (APIAdapter)

## Testing

### Test Pyramid
- **Unit tests (many)** - Single class, fast, isolated, mocked dependencies
- **Integration tests (some)** - Multiple components, real DB, test boundaries
- **E2E tests (few)** - Full system, critical paths only

### Test Structure (AAA)
- **Arrange** - Set up test world
- **Act** - Execute behavior under test
- **Assert** - Verify expected outcome

### Test Naming
- Concrete examples, domain language: `applies 20% discount for premium users`
- Avoid: `should work correctly`, `handles edge case`

### Test Doubles
- **Stub** - Returns predefined values
- **Spy** - Records how it was called
- **Mock** - Verifies expected interactions
- **Fake** - Working simplified implementation (InMemoryRepo)

### Test Builders
Use builder pattern for test objects to improve readability

### Avoid
- Testing implementation instead of behavior
- Too many mocks (tests prove nothing)
- Shared mutable state between tests
- Testing trivial code

## Background Jobs & Cron (BullMQ)

- **No `@nestjs/schedule` or `@Cron()` decorators** — cron scheduling is handled via BullMQ repeatable jobs
- **Worker mode** — the app runs in two modes: `web` (HTTP server) and `worker` (BullMQ processors)
- Worker mode is controlled by `APP_MODE=worker` env var, deployed as a separate K8s Deployment (`worker-deployment.yaml`)

### Pattern

```
Web Pod:
  BullJobsService.addJob()          → enqueue one-off jobs
  BullJobsService.addRepeatingJob() → used only by QueueService on worker init

Worker Pod (APP_MODE=worker):
  QueueService (OnModuleInit)       → schedules repeatable BullMQ jobs with cron patterns
  Processor (extends BaseWorkerService) → picks up and processes jobs from the queue
```

### Flow

```
QueueService.onModuleInit() → addRepeatingJob(queue, jobName, data, { pattern: '0 0 * * *' })
                                          ↓
                                    Redis (BullMQ)
                                          ↓
                              Processor.processJob(job) → calls domain service
```

### Rules

- **QueueService** — schedules repeatable jobs on worker startup only (`isWorker` check)
- **Processor** — extends `BaseWorkerService<T>`, implements `processJob()`, dispatches to domain services
- **Domain services** — contain the actual business logic (e.g., `MonthlyUsageResetService`)
- Never put cron logic in controllers or domain services
- K8s `worker-deployment.yaml` handles the worker pod, no K8s CronJobs needed for BullMQ jobs

## Forbidden

- No `SideEffectService` injection in services (only in listeners)
- No direct `sqsProducer.send()` or `snsPublisher.publish()` calls outside SideEffectService
- No `any` types
- No `uuid()` - use `ulid()` only
- No npm/yarn - pnpm only