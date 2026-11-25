@connection-lifecycle
Feature: Connection credential rotation (US1.5.3)
  As the platform
  I want a Connection to turn active only once it is proven, to rotate without downtime and to hand out its credential only on the record
  So that callbacks keep flowing and every use of a credential is traceable

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

@us-1.5.3
@ac-us-1.5.3-1
@evidence-partial
  Scenario: After a rotation both signing secrets verify for 24 hours
    Given that company has a "stripe" connection
    When I rotate that connection's signing secret
    Then the response status should be 200
    And Event Ingestion gets the new secret and the old one for 24 hours
    And "connection.rotated" is in the outbox for that connection
