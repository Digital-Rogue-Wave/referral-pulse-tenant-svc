@auth
Feature: Authentication rejects invalid JWTs (US1.2.1)
  As a backend API
  I want to enforce JWT authentication on all protected endpoints
  So that only properly authenticated clients can access tenant data

  Background:
    Given the application is running

@extension
  Scenario: Request without Authorization header is rejected
    When I send a GET request to "/api/v1/billing/plan" without any token
    Then the response status should be 401
    And the response should contain errorCode "authentication_error"

@us-1.2.1
@ac-us-1.2.1-3
@evidence-partial
  Scenario: Request with expired JWT is rejected
    Given I have an expired JWT for tenant "default-tenant"
    When I send a GET request to "/api/v1/billing/plan" with that token
    Then the response status should be 401

@us-1.2.1
@ac-us-1.2.1-3
@evidence-partial
  Scenario: Request with malformed JWT is rejected
    Given I have a malformed token "not.a.valid.jwt.at.all"
    When I send a GET request to "/api/v1/billing/plan" with that token
    Then the response status should be 401
