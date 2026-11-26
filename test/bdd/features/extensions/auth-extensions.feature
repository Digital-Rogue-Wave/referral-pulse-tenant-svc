@auth
Feature: Authentication extension behavior
  As a backend API
  I want to enforce JWT authentication on all protected endpoints
  So that only properly authenticated clients can access tenant data

  Background:
    Given the application is running

@extension
  Scenario: Active tenant with valid JWT can access the API
    Given I have a valid JWT for tenant "default-tenant"
    When I send a GET request to "/api/v1/billing/plan" with that token
    Then the response status is not 401
    And the response status is not 403

  @public-endpoint
@extension
  Scenario: Public endpoint is accessible without any token
    When I send a GET request to "/api/v1/billing/plans" without any token
    Then the response status should be 200
    And the response should be a non-empty array
