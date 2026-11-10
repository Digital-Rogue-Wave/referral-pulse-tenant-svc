@connection-revoke
Feature: The Owner revokes a connection, and its receiver refuses it at once (US1.5.3)
  As an Owner
  I want to cut off a compromised provider connection
  So that its callbacks are refused immediately, while past receipts stay attributable

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner
    And that company has a live "stripe" billing connection

  Scenario: Revoking keeps the row, disables it and announces it (F1, F3)
    When I revoke that connection
    Then the response status should be 204
    And that connection is kept, disabled and marked revoked
    And "connection.revoked" is in the outbox for that connection

  Scenario: Event Ingestion is told at once through the shared Redis (F2)
    When I revoke that connection
    Then the response status should be 204
    And the shared revocation marker for that connection is set for 3600 seconds

  Scenario: A revoked connection can't be revoked again
    When I revoke that connection
    And I revoke that connection
    Then the response status should be 404
