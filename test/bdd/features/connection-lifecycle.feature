@connection-lifecycle
Feature: A Connection is verified, rotated and its credential read under audit (US1.5.2-1.5.4, v5.2)
  As the platform
  I want a Connection to turn active only once it is proven, to rotate without downtime and to hand out its credential only on the record
  So that callbacks keep flowing and every use of a credential is traceable

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: The first verified callback activates an inbound connection, once
    Given that company has a "stripe" connection
    When Event Ingestion reports a verified callback for that connection
    Then the response status should be 200
    And that connection is "active" in the database
    And "connection.verified" is in the outbox for that connection
    When Event Ingestion reports a verified callback for that connection
    Then the response status should be 200
    And "connection.verified" is in the outbox for that connection once

  Scenario: After a rotation both signing secrets verify for 24 hours
    Given that company has a "stripe" connection
    When I rotate that connection's signing secret
    Then the response status should be 200
    And Event Ingestion gets the new secret and the old one for 24 hours
    And "connection.rotated" is in the outbox for that connection

  Scenario: A passing outbound test activates a payout connection
    Given that company has a "wise" connection
    And Wise accepts that connection's api key
    When I test that connection
    Then the response status should be 200
    And the test passed and the connection is "active"

  Scenario: An inbound connection has no outbound test
    Given that company has a "stripe" connection
    When I test that connection
    Then the response status should be 409

  Scenario: Reading the outbound credential writes an audit row naming the service
    Given that company has a "wise" connection
    When the payout worker reads that connection's credential
    Then the response status should be 200
    And the credential is that connection's api key
    And the audit log records "connection.credential_read" by "service:payout-worker"

  Scenario: A revoked connection's credential cannot be read
    Given that company has a "wise" connection
    When I revoke that connection
    And the payout worker reads that connection's credential
    Then the response status should be 404
