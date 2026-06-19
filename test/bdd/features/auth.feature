@auth
Feature: Authentication and Authorization
  As a backend API
  I want to enforce JWT authentication on all protected endpoints
  So that only properly authenticated clients can access tenant data

  Background:
    Given the application is running

  Scenario: Request without Authorization header is rejected
    When I send a GET request to "/api/v1/billings/subscription" without any token
    Then the response status should be 401
    And the response should contain errorCode "authentication_error"

  Scenario: Request with expired JWT is rejected
    Given I have an expired JWT for tenant "default-tenant"
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status should be 401

  Scenario: Request with malformed JWT is rejected
    Given I have a malformed token "not.a.valid.jwt.at.all"
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status should be 401

  Scenario: Valid JWT for non-existent tenant returns 404
    Given I have a valid JWT for tenant "bdd-nonexistent-tenant-xyz"
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status should be 404
    And the response should contain errorCode "tenant_not_found"

  Scenario: Active tenant with valid JWT can access the API
    Given I have a valid JWT for tenant "default-tenant"
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status is not 401
    And the response status is not 403

  @public-endpoint
  Scenario: Public endpoint is accessible without any token
    When I send a GET request to "/api/v1/billings/plans" without any token
    Then the response status should be 200
    And the response should be a non-empty array

  Scenario: Service token can access internal endpoint
    Given I have a service token for tenant "default-tenant"
    When I send a GET request to "/api/v1/internal/tenants/default-tenant/status" with that token
    Then the response status should be 200
