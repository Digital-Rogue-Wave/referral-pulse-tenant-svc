@audit-log-read
Feature: The Owner consults the audit trail (US1.9.2)
  As an Owner
  I want to read who changed what, and when, newest first, with filters
  So that I can answer "who did this?" without asking support

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner
    And that company changed its currency from "EUR" to "USD"

  Scenario: The Owner reads the trail, newest first, without the IP hash (F1, F2)
    When I send a GET request to "/api/v1/audit-log" with that token
    Then the response status should be 200
    And the first audit entry is "tenant_setting.updated" by the Owner, from "EUR" to "USD"
    And the audit entries are newest first
    And no audit entry carries an IP hash

  Scenario: Filters narrow the trail (F3)
    When I send a GET request to "/api/v1/audit-log?action=tenant_setting.created" with that token
    Then the response status should be 200
    And every audit entry is a "tenant_setting.created"
    And there is exactly 1 audit entry

  Scenario: The trail is paged with cursors (F3)
    When I send a GET request to "/api/v1/audit-log?limit=1" with that token
    Then the response status should be 200
    And there is exactly 1 audit entry, and more after it
    When I follow the next cursor with that token
    Then the response status should be 200
    And the page holds an older audit entry than the first page

  Scenario: Another company's entries never show
    Given another company has an audit entry "bdd.other_company"
    When I send a GET request to "/api/v1/audit-log?action=bdd.other_company" with that token
    Then the response status should be 200
    And there is exactly 0 audit entries

  Scenario: Only the Owner may read it
    Given I am a member of that billing company without audit:read
    When I send a GET request to "/api/v1/audit-log" with that token
    Then the response status should be 403
