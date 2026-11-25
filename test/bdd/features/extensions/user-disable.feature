@user-disable
Feature: The Owner disables a member, and enables them again (tenant-service extension)
  As an Owner
  I want to stop a member's access without removing them
  So that I can give it back later, with the same role, and the trail shows both

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner
    And that company has an "operator" member

@extension
  Scenario: Disabling keeps the member, revokes their Keto membership and is audited
    When I "disable" that member
    Then the response status should be 200
    And that member answers with status "disabled" and a disabled date
    And that member's row is kept, disabled and not deleted
    And a Keto "remove_member" effect is queued for that member
    And "user.disabled" is on the audit trail for that member

@extension
  Scenario: Enabling restores the member's role in Keto and is audited
    When I "disable" that member
    And I "enable" that member
    Then the response status should be 200
    And that member answers with status "active" and no disabled date
    And a Keto "assign_role" effect is queued for that member
    And "user.enabled" is on the audit trail for that member

@extension
  Scenario: Disabling twice answers the same disabled member
    When I "disable" that member
    And I "disable" that member
    Then the response status should be 200
    And that member answers with status "disabled" and a disabled date

@extension
  Scenario: Nobody disables themselves, so the Owner is never disabled
    When I "disable" the Owner
    Then the response status should be 403
