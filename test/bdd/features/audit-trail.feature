@audit-trail
Feature: Every sensitive action writes an append-only audit record (US1.9.1)
  As the platform
  I want each operator action recorded once, with who, what, before, after and the request id
  So that nobody can act without a trace, and nobody can alter the trace

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: A settings change leaves one audit row: who, before, after and the request id
    When I send a PUT request to "/api/v1/tenant-settings" with body:
      """
      { "currencyCode": "EUR" }
      """
    Then the response status should be 200
    When I send a PUT request to "/api/v1/tenant-settings" with body:
      """
      { "currencyCode": "USD" }
      """
    Then the response status should be 200
    And that company has 1 "tenant_setting.updated" audit row
    And that row is by the Owner, from currency "EUR" to "USD", with the response's request id

  Scenario: A refused change leaves no audit row
    Given I am a member of that billing company without tenants:write
    When I send a PUT request to "/api/v1/tenant-settings" with body:
      """
      { "currencyCode": "USD" }
      """
    Then the response status should be 403
    And that company has 0 "tenant_setting.created" audit rows

  Scenario: The database refuses to change or delete an audit row (F3)
    Given that company has an audit row
    Then updating that audit row is refused as append-only
    And deleting that audit row is refused as append-only
    And that audit row is unchanged

  Scenario: Only a transaction that opts in, like the retention sweep, can delete audit rows (F3)
    Given that company has an audit row
    When that company's audit rows are purged the way the retention sweeper does
    Then that company has 0 "bdd.audit_probe" audit rows
