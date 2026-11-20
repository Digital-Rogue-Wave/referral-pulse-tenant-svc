@row-level-security
Feature: Row-level security keeps every tenant's rows apart in the database (US1.3.9, v5.2 DB Model 0.8)
  As the platform
  I want PostgreSQL itself to restrict each tenant-scoped row to its tenant
  So that an application bug that forgets the tenant filter returns nothing instead of another tenant's data

  Background:
    Given the application is running

  Scenario: Every tenant-scoped table has a forced tenant policy (the migration check)
    Then every table with a tenant_id column has row-level security enabled and forced
    And each of them has the tenant_isolation policy

  Scenario: The application role runs as a role that cannot bypass the policies
    Then the application connection is neither a superuser nor allowed to bypass row-level security

  Scenario: Without a tenant, the application role reads no tenant row at all
    Then a query on users without a tenant setting returns no rows

  Scenario: A query that forgets the tenant filter still only returns its own tenant's rows
    Given two companies have signed up
    When the first company's request lists users with no tenant filter
    Then every row returned belongs to the first company
    And the second company's users are not among them
