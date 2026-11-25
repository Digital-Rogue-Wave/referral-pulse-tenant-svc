@widget-secret
Feature: The Owner reads and rotates the widget signing secrets (US1.5.5)
  As an Owner
  I want to read the secrets my backend signs the widget token with, each with its kid, and rotate them
  So that only my backend can vouch for who is looking at the referral widget, and rotating causes no downtime

  Background:
    Given the application is running
    And a company has signed itself up

@extension
  Scenario: The Owner reads the one active secret with its kid, and the read is audited
    Given I am that company's Owner
    When I send a GET request to "/api/v1/tenant/widget-secret" with that token
    Then the response status should be 200
    And the response holds 1 secret, a kid and a 64-character hex secret each
    And it is what Event Ingestion receives
    And the database does not hold it in plain text
    And the read is audit-logged with the Owner as actor

@us-1.5.5
@ac-us-1.5.5-1
@evidence-partial
  Scenario: A member without api_keys:manage is refused
    Given I am a member of that company without api_keys:manage
    When I send a GET request to "/api/v1/tenant/widget-secret" with that token
    Then the response status should be 403

@extension
  Scenario: The secret is in no other answer
    Given I am that company's Owner
    When I send a GET request to "/api/v1/tenant" with that token
    Then the response status should be 200
    And the response should not contain a "widget_signing_secrets" field
    And the response should not contain a "secrets" field

@us-1.5.5
@ac-us-1.5.5-2
@ac-us-1.5.5-3
@evidence-partial
  Scenario: Rotation adds a new kid and keeps the previous one for 7 days
    Given I am that company's Owner
    And I have read the current secret
    When I send a POST request to "/api/v1/tenant/widget-secret/rotate" with that token
    Then the response status should be 200
    And the response holds 2 secrets, a kid and a 64-character hex secret each
    And the newest is new and the previous one is the secret before the rotation, valid until 7 days from now
    And it is what Event Ingestion receives
    And "tenant.widget_secret_rotated" is queued for that company with the new kid and without a secret
    And the rotation is audit-logged with the Owner as actor
