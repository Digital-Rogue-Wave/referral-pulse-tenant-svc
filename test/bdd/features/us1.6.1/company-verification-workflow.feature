@company-verification
Feature: Company verification workflow (US1.6.1)
  As the platform
  I want a company to move to pending_review only when the KYB provider calls back, and to be decided by a Super Admin
  So that payouts are gated on a human decision announced as tenant.verified

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

@us-1.6.1
@ac-us-1.6.1-2
@evidence-partial
  Scenario: The provider's callback opens the case for review and starts the workflow
    Given I opened a company verification session
    When the KYB provider calls back for that session
    Then the company's verification reads "pending_review"
    And "tenant.verified" is in the outbox with status "pending_review" decided by "provider:fake"
    And the account_verification workflow was started and its id stored on the case
