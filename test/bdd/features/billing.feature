@billing
Feature: Billing Management
  As an authenticated tenant
  I want to manage my subscription and billing information
  So that I can view and change my plan

  Background:
    Given the application is running
    And I have a valid JWT for tenant "default-tenant"

  Scenario: Get current subscription returns plan data
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status should be 200
    And the response should contain a "plan" field
    And the response should contain a "status" field

  @public-endpoint
  Scenario: List public billing plans without authentication
    When I send a GET request to "/api/v1/billings/plans" without any token
    Then the response status should be 200
    And the response should be a non-empty array
    And each item in the response should have a "name" field

  Scenario: Create checkout session returns a Stripe URL
    Given the Stripe checkout API is mocked to return a checkout URL
    When I send a POST request to "/api/v1/billings/subscription/checkout" with body:
      """
      { "plan": "Starter" }
      """
    Then the response status should be 200
    And the response should contain a "checkoutUrl" field

  Scenario: Get usage summary returns usage metrics
    When I send a GET request to "/api/v1/billings/usage" with that token
    Then the response status should be 200
    And the response should contain a "metrics" field

  Scenario: Preview subscription upgrade returns 200
    When I send a POST request to "/api/v1/billings/subscription/upgrade/preview" with body:
      """
      { "targetPlan": "Growth" }
      """
    Then the response status should be 200
