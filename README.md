# Referral Pulse Service Template

A NestJS-based microservice template for the Referral Pulse campaign system.

---

## Getting Started

Follow these steps to get the service running locally:

| Step | Description                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------- |
| 1    | [Set up infrastructure](docs/template/installing-and-running.md#1-clone-and-start-infrastructure) |
| 2    | [Configure environment](docs/template/installing-and-running.md#2-clone-the-service-repository)   |
| 3    | [Set up database](docs/template/installing-and-running.md#3-configure-environment-variables)      |
| 4    | [Start application](docs/template/installing-and-running.md#8-start-development-server)           |

### Quick Commands

```bash
# Infrastructure
git clone git@github.com:Digital-Rogue-Wave/referral-pulse-infrastucture.git
cd referral-pulse-infrastucture && docker-compose up --build -d

# Application
cp env.example .env.development
pnpm install
pnpm prisma migrate dev --name init
pnpm prisma generate
pnpm start:dev
```

---

## Documentation

| Guide                                                             | Description                          |
| ----------------------------------------------------------------- | ------------------------------------ |
| [Installation & Running](docs/template/installing-and-running.md) | Detailed setup guide                 |
| [Working with Database](docs/template/database.md)                | Prisma workflow, migrations, seeding |
| [Serialization](docs/template/serialization.md)                   | Response transformation              |
| [Architecture Overview](docs/architecture.md)                     | System design documentation          |
| [Implementation Reference](tenant-implementation.md)              | Whole-service technical reference    |
| [Service Guide](TENANT_GUIDE.md)                                  | Plain-language tour for newcomers    |
| [Testing Guide](TESTING_GUIDE.md)                                 | Run & write unit/BDD tests with mock data |
| [Decisions & Contract Notes](NOTE.md)                             | Spec deviations, gaps, cross-team items |
| [Billing](BILLING.md)                                             | Billing-specific deep dive           |

---

## Features

- Multi-tenant architecture with AsyncLocalStorage
- Event-driven design with transaction-aware event emission
- Prisma ORM with PostgreSQL
- AWS services integration (S3, SQS, SNS) via LocalStack
- BullMQ for job queue management
- OpenAPI/Swagger documentation
