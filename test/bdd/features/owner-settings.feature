@owner-settings
Feature: The Owner settings, in one route (US1.7.1 F3/F8, US1.7.2 F3, US1.7.3 F6; E1 decisions D8, D9, D11)
  As an Owner
  I want to read and change the invitation channel, the retention window and the payout verification threshold
  So that the legal and privacy settings live in one audited place

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: A company with no country gets the lawful default, shown as the platform's
    When I read the Owner settings
    Then the response status should be 200
    And the settings read invitation channel "forbidden" from "default", retention 24, no verification threshold

  Scenario: The Owner's choices are stored, announced and audited
    When I change the Owner settings to:
      """
      { "invitation_channel": "allowed", "retention_months": 12, "verification_required_above": 50000, "verification_required_above_currency": "eur" }
      """
    Then the response status should be 200
    And the settings read invitation channel "allowed" from "explicit", retention 12, threshold 50000 "EUR"
    And "tenant.updated" in the outbox carries invitation channel "allowed", retention 12 and threshold 50000 "EUR"
    And that company has 1 "tenant.updated" audit row

  Scenario: Null puts the channel back on the platform default and clears the threshold
    When I change the Owner settings to:
      """
      { "invitation_channel": "allowed", "verification_required_above": 100, "verification_required_above_currency": "EUR" }
      """
    And I change the Owner settings to:
      """
      { "invitation_channel": null, "verification_required_above": null }
      """
    Then the response status should be 200
    And the settings read invitation channel "forbidden" from "default", retention 24, no verification threshold

  Scenario Outline: Values outside the rules are refused with 400
    When I change the Owner settings to:
      """
      <body>
      """
    Then the response status should be 400

    Examples:
      | body                                          |
      | { "retention_months": 5 }                     |
      | { "retention_months": 37 }                    |
      | { "invitation_channel": "sometimes" }         |
      | { "verification_required_above": 100 }        |
      | { "verification_required_above": -1, "verification_required_above_currency": "EUR" } |

  Scenario: The profile route no longer takes an Owner setting
    When I send the profile update with "retention_months" set to "12"
    Then the response status should be 400
