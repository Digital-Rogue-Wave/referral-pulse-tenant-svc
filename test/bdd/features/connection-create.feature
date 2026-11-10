@connection-create
Feature: The Owner creates a provider connection and gets its receiver URL (US1.5.1)
  As an Owner
  I want to register a provider's signing secret and get the URL to paste into its console
  So that the provider's callbacks reach my company, verified with my own secret

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: A connection names its real provider, and its type follows from it (F7, F5)
    When I connect "tremendous" with no connection type
    Then the response status should be 201
    And the connection is a "gift_card" connection
    And its receiver URL is absolute and ends with its own path (F4)

  Scenario: The old category names are refused (F7)
    When I connect "gift_card" with no connection type
    Then the response status should be 400
    When I connect "crm" with no connection type
    Then the response status should be 400

  Scenario: A provider can't be paired with another type (F5)
    When I connect "paddle" as a "crm" connection
    Then the response status should be 400
    And the error names the field "connection_type"

  Scenario: The Owner lists the company's connections (F2)
    Given I connected "stripe" and "hubspot"
    When I send a GET request to "/api/v1/connections" with that token
    Then the response status should be 200
    And the list holds a "billing" "stripe" connection and a "crm" "hubspot" connection

  Scenario: The permission is re-checked live in Keto, not read from the token (F3)
    Given I am a member of that company whose Keto access to connections was removed
    When I connect "stripe" with no connection type
    Then the response status should be 403
