@billing
Feature: Public billing plan catalog extension
  As an authenticated tenant
  I want to manage my subscription and billing information
  So that I can view and change my plan

  Background:
    Given the application is running
    And I have a valid JWT for tenant "default-tenant"

  @public-endpoint
@extension
  Scenario: List public billing plans without authentication
    When I send a GET request to "/api/v1/billing/plans" without any token
    Then the response status should be 200
    And the response should be a non-empty array
    And each item in the response should have a "name" field
