@owner-settings
Feature: Retired Owner settings extension
  As an Owner
  I want to read and change the raw-data retention window
  So that the privacy setting lives in one audited place
  (v5.2: no invitation setting exists, and the payout verification threshold is a Program setting)

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

@extension
@retired-behavior
  Scenario Outline: Retired Owner settings are refused with 400: <case>
    When I change the Owner settings to:
      """
      <body>
      """
    Then the response status should be 400
    Examples:
      | case                                      | body                                          |
      | the retired invitation setting            | { "invitation_channel": "allowed" }           |
      | the retired verification threshold        | { "verification_required_above": 100, "verification_required_above_currency": "EUR" } |

@extension
@retired-behavior
  Scenario: The profile route no longer takes an Owner setting
    When I send the profile update with "retention_months" set to "12"
    Then the response status should be 400
