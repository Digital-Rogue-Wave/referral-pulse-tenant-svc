@company-verification
Feature: Company verification: provider callback, Super Admin decision, tenant.verified (US1.6.1, US1.6.2, US1.6.4, v5.2)
  As the platform
  I want a company to move to pending_review only when the KYB provider calls back, and to be decided by a Super Admin
  So that payouts are gated on a human decision announced as tenant.verified

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: Opening a session returns the provider link and changes nothing
    When I open a company verification session
    Then the response status should be 200
    And the session answer says "unverified" with a provider link
    And the company's verification reads "unverified"

  Scenario: The provider's callback opens the case for review and starts the workflow
    Given I opened a company verification session
    When the KYB provider calls back for that session
    Then the company's verification reads "pending_review"
    And "tenant.verified" is in the outbox with status "pending_review" decided by "provider:fake"
    And the account_verification workflow was started and its id stored on the case

  Scenario: A Super Admin verifies with a reason; the decision is audited and signalled
    Given the company's verification is under review
    When a Super Admin verifies that case with the reason "Registry extract matches"
    Then the response status should be 200
    And the company's verification reads "verified"
    And "tenant.verified" is in the outbox with status "verified" decided by "staff:kratos-bdd-staff"
    And the audit log records "tenant.verified" by "staff:kratos-bdd-staff" with the reason "Registry extract matches"
    And the account_verification workflow was signalled "verified"

  Scenario: A decision without a reason is refused
    Given the company's verification is under review
    When a Super Admin verifies that case with no reason
    Then the response status should be 400

  Scenario: A rejection shows its reason to the Owner, who may resubmit
    Given the company's verification is under review
    When a Super Admin rejects that case with the reason "Company not found in the registry"
    Then the response status should be 200
    And the company's verification reads "rejected" with the reason "Company not found in the registry"
    When I open a company verification session
    Then the response status should be 200
    And the session answer says "rejected" with a provider link

  Scenario: A decided case cannot be decided again
    Given the company's verification is under review
    And a Super Admin verifies that case with the reason "Registry extract matches"
    When a Super Admin rejects that case with the reason "Second thoughts"
    Then the response status should be 409
