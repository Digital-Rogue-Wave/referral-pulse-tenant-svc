@auth
Feature: Service token authentication (US1.3.6)
  As a backend API
  I want to enforce JWT authentication on all protected endpoints
  So that only properly authenticated clients can access tenant data

  Background:
    Given the application is running

@us-1.3.6
@ac-us-1.3.6-1
@evidence-partial
  Scenario: Service token can access internal endpoint
    Given I have a service token for tenant "default-tenant"
    When I send a GET request to "/api/v1/internal/tenants/default-tenant/status" with that token
    Then the response status should be 200
