@billing-plan
Feature: The Owner sees the current plan and its limits (US1.8.1)
  As an Owner
  I want to see my plan, what it allows and how much of it I use
  So that I know when to upgrade

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: The current plan is read at the v5.1 path, and the old path is gone
    When I send a GET request to "/api/v1/billing/plan" with that token
    Then the response status should be 200
    And the response should contain a "plan" field with value "Free"
    When I send a GET request to "/api/v1/billings/subscription" with that token
    Then the response status should be 404

  Scenario: All five plans are offered, each with its SDK limit and a price field
    When I send a GET request to "/api/v1/billing/plans" without any token
    Then the response status should be 200
    And the plans offered are "Free, Starter, Growth, Scale, Enterprise"
    And every plan has an "sdk_requests_per_minute" limit and a "price" field

  Scenario: Usage shows every plan limit with its live value, even with no daily snapshot yet
    When I send a GET request to "/api/v1/billing/usage" with that token
    Then the response status should be 200
    And the usage of "seats" is 1 of 2
    And every limit of the "Free" plan is listed in the usage

  Scenario: The plan usage percentage is seats in use over the plan's seat limit
    When I send a GET request to "/api/v1/tenants/stats" with that token
    Then the response status should be 200
    And the response should contain a "plan_usage_percentage" field with value "50"

  Scenario: Event Ingestion reads the SDK limit from the tenant's entitlements
    When Event Ingestion reads that company's entitlements
    Then the response status should be 200
    And the entitlements limit "sdk_requests_per_minute" is 20
