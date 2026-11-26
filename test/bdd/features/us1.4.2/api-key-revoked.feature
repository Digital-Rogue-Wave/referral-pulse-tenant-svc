@api-key-revoked
Feature: A revoked API key stays visible, with who revoked it and why (US1.4.2 F1, E1 decision D6)
  As an Owner
  I want revoked keys kept in the dashboard
  So that I can answer "who revoked which key, when and why" without digging in logs

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner
    When I create an API key
    And I revoke that API key because "leaked in a public repo"

@us-1.4.2
@ac-us-1.4.2-2
@evidence-partial
  Scenario: The live list hides it; the revoked and full lists show it with who and why
    Then the response status should be 204
    And the API key list "without a status" does not hold that key
    And the API key list "?status=revoked" holds that key, revoked by me because "leaked in a public repo"
    And the API key list "?status=all" holds that key, revoked by me because "leaked in a public repo"

@us-1.4.2
@ac-us-1.4.2-2
@evidence-partial
  Scenario: Its detail still answers
    When I read that API key
    Then the response status should be 200
    And the response should contain a "revoked_at" field

@us-1.4.2
@ac-us-1.4.2-3
@evidence-direct
  Scenario: A revoked key cannot be reactivated
    When I revoke that API key because "again"
    Then the response status should be 409
    When I rotate that API key
    Then the response status should be 409
