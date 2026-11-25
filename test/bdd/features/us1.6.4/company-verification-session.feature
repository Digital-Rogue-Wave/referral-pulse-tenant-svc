@company-verification
Feature: Owner company verification sessions (US1.6.4)
  As the platform
  I want a company to move to pending_review only when the KYB provider calls back, and to be decided by a Super Admin
  So that payouts are gated on a human decision announced as tenant.verified

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

@us-1.6.4
@ac-us-1.6.4-1
@evidence-partial
  Scenario: Opening a session returns the provider link and changes nothing
    When I open a company verification session
    Then the response status should be 200
    And the session answer says "unverified" with a provider link
    And the company's verification reads "unverified"

@us-1.6.4
@ac-us-1.6.4-3
@evidence-partial
  Scenario: A rejection shows its reason to the Owner, who may resubmit
    Given the company's verification is under review
    When a Super Admin rejects that case with the reason "Company not found in the registry"
    Then the response status should be 200
    And the company's verification reads "rejected" with the reason "Company not found in the registry"
    When I open a company verification session
    Then the response status should be 200
    And the session answer says "rejected" with a provider link
