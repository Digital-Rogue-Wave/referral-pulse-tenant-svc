@billing
Feature: Current subscription plan (US1.8.1)
  As an authenticated tenant
  I want to manage my subscription and billing information
  So that I can view and change my plan

  Background:
    Given the application is running
    And I have a valid JWT for tenant "default-tenant"

@us-1.8.1
@ac-us-1.8.1-1
@evidence-partial
  Scenario: Get current subscription returns plan data
    When I send a GET request to "/api/v1/billing/plan" with that token
    Then the response status should be 200
    And the response should contain a "plan" field
    And the response should contain a "subscription_status" field
