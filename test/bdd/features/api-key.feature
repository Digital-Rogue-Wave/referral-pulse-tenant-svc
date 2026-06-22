@api-keys
Feature: API Key lifecycle
  As an authenticated tenant
  I want to create and rotate API keys
  So that I can manage credentials without losing access

  Background:
    Given the application is running
    And I have a valid JWT for tenant "default-tenant"

  Scenario: Create then rotate an API key issues a fresh secret
    When I create an API key
    Then the response status should be 201
    And the response should contain a "rawKey" field
    When I rotate that API key
    Then the response status should be 200
    And the response should contain a "rawKey" field
    And the response rawKey should differ from the created key

  Scenario: Rotating a non-existent key returns 404
    When I send a POST request to "/api/v1/api-keys/does-not-exist/rotate" with that token
    Then the response status should be 404

  @public-endpoint
  Scenario: Creating an API key requires authentication
    When I send a POST request to "/api/v1/api-keys" without any token
    Then the response status should be 401
