@billing
Feature: Subscription checkout extension
  As an authenticated tenant
  I want to manage my subscription and billing information
  So that I can view and change my plan

  Background:
    Given the application is running
    And I have a valid JWT for tenant "default-tenant"

@extension
  Scenario: Create checkout session returns a Stripe URL
    Given the Stripe checkout API is mocked to return a checkout URL
    When I send a POST request to "/api/v1/billing/subscription/checkout" with body:
      """
      { "plan": "Starter" }
      """
    Then the response status should be 200
    And the response should contain a "checkout_url" field
