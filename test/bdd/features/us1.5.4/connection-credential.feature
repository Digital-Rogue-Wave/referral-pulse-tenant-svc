@connection-lifecycle
Feature: Audited Connection credential access (US1.5.4)
  As the platform
  I want a Connection to turn active only once it is proven, to rotate without downtime and to hand out its credential only on the record
  So that callbacks keep flowing and every use of a credential is traceable

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

@us-1.5.4
@ac-us-1.5.4-2
@ac-us-1.5.4-3
@evidence-partial
  Scenario: Reading the outbound credential writes an audit row naming the service
    Given that company has a "wise" connection
    When the payout worker reads that connection's credential
    Then the response status should be 200
    And the credential is that connection's api key
    And the audit log records "connection.credential_read" by "service:payout-worker"

@us-1.5.4
@ac-us-1.5.4-2
@ac-us-1.5.4-3
@evidence-partial
  Scenario: A revoked connection's credential cannot be read
    Given that company has a "wise" connection
    When I revoke that connection
    And the payout worker reads that connection's credential
    Then the response status should be 404
