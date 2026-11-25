@company-verification
Feature: Super Admin company verification decisions (US1.6.2)
  As the platform
  I want a company to move to pending_review only when the KYB provider calls back, and to be decided by a Super Admin
  So that payouts are gated on a human decision announced as tenant.verified

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

@us-1.6.2
@ac-us-1.6.2-1
@ac-us-1.6.2-2
@evidence-partial
  Scenario: A Super Admin verifies with a reason; the decision is audited and signalled
    Given the company's verification is under review
    When a Super Admin verifies that case with the reason "Registry extract matches"
    Then the response status should be 200
    And the company's verification reads "verified"
    And "tenant.verified" is in the outbox with status "verified" decided by "staff:kratos-bdd-staff"
    And the audit log records "tenant.verified" by "staff:kratos-bdd-staff" with the reason "Registry extract matches"
    And the account_verification workflow was signalled "verified"

@us-1.6.2
@ac-us-1.6.2-1
@evidence-partial
  Scenario: A decision without a reason is refused
    Given the company's verification is under review
    When a Super Admin verifies that case with no reason
    Then the response status should be 400

@extension
  Scenario: A decided case cannot be decided again
    Given the company's verification is under review
    And a Super Admin verifies that case with the reason "Registry extract matches"
    When a Super Admin rejects that case with the reason "Second thoughts"
    Then the response status should be 409
