@data-subject-request
Feature: The Owner records a data-subject request of every type (US12.2.1, E1 decision D4)
  As an Owner
  I want to record access, portability and erasure requests from a data subject
  So that each one is dated, answerable and kept as proof

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

@us-12.2.1
@ac-us-12.2.1-1
@evidence-partial
  Scenario Outline: The <type> request is recorded as pending
    When I submit a "<type>" data-subject request
    Then the response status should be 201
    And the request is answered as "<type>", "pending", due within 30 days
    And the stored request reads "pending"
    And "data_subject_request.requested" is in the outbox for that request

    Examples:
      | type        |
      | access      |
      | portability |
      | erasure     |
