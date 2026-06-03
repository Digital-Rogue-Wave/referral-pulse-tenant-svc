@guards
Feature: Tenant Status Guards
  As the platform
  I want to enforce tenant status restrictions on protected endpoints
  So that suspended or locked tenants cannot access resources

  Background:
    Given the application is running

  @needs-suspended-tenant
  Scenario: Suspended tenant is blocked from billing endpoints
    Given I have a valid JWT for the current fixture tenant
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status should be 403
    And the response should contain errorCode "TENANT_SUSPENDED"
    And the response should contain a "title" field with value "Forbidden"

  @needs-locked-tenant
  Scenario: Locked tenant is blocked from billing endpoints
    Given I have a valid JWT for the current fixture tenant
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status should be 403
    And the response should contain errorCode "TENANT_LOCKED"

  @needs-locked-tenant
  Scenario: Locked tenant error response has the correct shape
    Given I have a valid JWT for the current fixture tenant
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status should be 403
    And the response should contain a "title" field with value "Forbidden"
    And the response should contain a "detail" field
    And the response should contain a "errorCode" field

  @needs-active-tenant
  Scenario: Active tenant passes the tenant status guard
    Given I have a valid JWT for the current fixture tenant
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status is not 403

  @public-endpoint
  Scenario: Public endpoint bypasses tenant status guard entirely
    When I send a GET request to "/api/v1/billings/plans" without any token
    Then the response status should be 200
