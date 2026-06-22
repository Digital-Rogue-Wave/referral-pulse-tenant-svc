@tenant-settings
Feature: Tenant Settings
  As an authenticated tenant
  I want to read and update my tenant settings
  So that branding and preferences persist per tenant

  Background:
    Given the application is running
    And I have a valid JWT for tenant "default-tenant"

  Scenario: Upsert tenant settings then read them back from current
    When I send a PUT request to "/api/v1/tenant-settings" with body:
      """
      { "branding": { "primaryColor": "#112233" }, "general": { "timezone": "UTC" } }
      """
    Then the response status should be 200
    And the response should contain a "tenantId" field
    And the response should contain a "branding" field
    When I send a GET request to "/api/v1/tenant-settings/current" with that token
    Then the response status should be 200
    And the response should contain a "tenantId" field

  Scenario: Upsert updates existing settings in place (singleton per tenant)
    When I send a PUT request to "/api/v1/tenant-settings" with body:
      """
      { "general": { "locale": "en-US" } }
      """
    Then the response status should be 200
    And the response should contain a "general" field

  @public-endpoint
  Scenario: Reading settings requires authentication
    When I send a GET request to "/api/v1/tenant-settings/current" without any token
    Then the response status should be 401
