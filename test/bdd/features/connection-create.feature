@connection-create
Feature: The Owner creates a Connection and gets its inbound URL (US1.5.1, v5.2 API 3.16)
  As an Owner
  I want to register a provider's credentials and get the URL to paste into its console
  So that the provider's callbacks reach my company, verified with my own secret

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: A billing provider is inbound, pending verification, with an absolute inbound URL
    When I connect "stripe" with its credentials
    Then the response status should be 201
    And the connection is "inbound" and "pending_verification"
    And its inbound URL is absolute and ends with its own path
    And no credential is in the response

  Scenario: Zapier is outbound only: no credentials, no inbound URL
    When I connect "zapier" with its credentials
    Then the response status should be 201
    And the connection is "outbound" and "pending_verification"
    And it has no inbound URL

  Scenario: The provider matrix fixes the direction
    When I connect "paddle" as an "outbound" connection
    Then the response status should be 400
    And the error names the field "direction"

  Scenario: A payout provider needs its outbound credential
    When I connect "wise" without credentials
    Then the response status should be 400
    And the error names the field "credentials.api_key"

  Scenario: The old category names are refused
    When I connect "crm" with its credentials
    Then the response status should be 400

  Scenario: The Owner lists and retrieves the company's connections
    Given I connected "stripe" and "hubspot"
    When I send a GET request to "/api/v1/connections" with that token
    Then the response status should be 200
    And the list holds an "inbound" "stripe" connection and a "both" "hubspot" connection
    When I retrieve the last connection
    Then the response status should be 200
    And no credential is in the response

  Scenario: The permission is re-checked live in Keto, not read from the token
    Given I am a member of that company whose Keto access to connections was removed
    When I connect "stripe" with its credentials
    Then the response status should be 403
