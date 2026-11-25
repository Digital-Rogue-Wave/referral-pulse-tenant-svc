@auth
Feature: Tenant resolution for a non-existent tenant (US1.3.7)
  As a backend API
  I want to enforce JWT authentication on all protected endpoints
  So that only properly authenticated clients can access tenant data

  Background:
    Given the application is running

@us-1.3.7
@ac-us-1.3.7-2
@evidence-partial
  Scenario: Valid JWT for non-existent tenant returns 404
    Given I have a valid JWT for tenant "bdd-nonexistent-tenant-xyz"
    When I send a GET request to "/api/v1/billing/plan" with that token
    Then the response status should be 404
    And the response should contain errorCode "tenant_not_found"
