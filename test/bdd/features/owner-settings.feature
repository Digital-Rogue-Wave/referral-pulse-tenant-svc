@owner-settings
Feature: The Owner settings route (US1.7.3 F6; E1 decision D8; v5.2 Appendix A #79, API §3.1)
  As an Owner
  I want to read and change the raw-data retention window
  So that the privacy setting lives in one audited place
  (v5.2: no invitation setting exists, and the payout verification threshold is a Program setting)

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: A new company reads the default retention, and no retired setting
    When I read the Owner settings
    Then the response status should be 200
    And the settings read retention 24 and carry no invitation channel nor verification threshold

  Scenario: The Owner reads the tenant record (v5.2 API §3.17, US1.7.3)
    When I send a GET request to "/api/v1/tenant" with that token
    Then the response status should be 200
    And the tenant record reads plan "Free", verification "unverified", retention 24 and region "eu-central-1"

  Scenario: The Owner's choice is stored, announced and audited
    When I change the Owner settings to:
      """
      { "retention_months": 12 }
      """
    Then the response status should be 200
    And the settings read retention 12 and carry no invitation channel nor verification threshold
    And "tenant.updated" in the outbox carries retention 12 and no retired setting
    And that company has 1 "tenant.updated" audit row

  Scenario Outline: Values outside the rules, and the retired settings, are refused with 400
    When I change the Owner settings to:
      """
      <body>
      """
    Then the response status should be 400

    Examples:
      | body                                          |
      | { "retention_months": 5 }                     |
      | { "retention_months": 37 }                    |
      | { "invitation_channel": "allowed" }           |
      | { "verification_required_above": 100, "verification_required_above_currency": "EUR" } |

  Scenario: The profile route no longer takes an Owner setting
    When I send the profile update with "retention_months" set to "12"
    Then the response status should be 400
