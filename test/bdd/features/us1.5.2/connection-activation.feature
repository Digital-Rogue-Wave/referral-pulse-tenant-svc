@connection-lifecycle
Feature: Connection activation (US1.5.2)
  As the platform
  I want a Connection to turn active only once it is proven, to rotate without downtime and to hand out its credential only on the record
  So that callbacks keep flowing and every use of a credential is traceable

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

@us-1.5.2
@ac-us-1.5.2-1
@evidence-partial
  Scenario: The first verified callback activates an inbound connection, once
    Given that company has a "stripe" connection
    When Event Ingestion reports a verified callback for that connection
    Then the response status should be 200
    And that connection is "active" in the database
    And "connection.verified" is in the outbox for that connection
    When Event Ingestion reports a verified callback for that connection
    Then the response status should be 200
    And "connection.verified" is in the outbox for that connection once

@us-1.5.2
@ac-us-1.5.2-2
@evidence-partial
  Scenario: A passing outbound test activates a payout connection
    Given that company has a "wise" connection
    And Wise accepts that connection's api key
    When I test that connection
    Then the response status should be 200
    And the test passed and the connection is "active"

@extension
  Scenario: An inbound connection has no outbound test
    Given that company has a "stripe" connection
    When I test that connection
    Then the response status should be 409
