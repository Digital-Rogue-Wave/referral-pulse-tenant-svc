@widget-secret
Feature: The Owner reads and rotates the widget-token secret (US1.5.4)
  As an Owner
  I want to read the secret my backend signs the widget user JWT with, and replace it if it leaks
  So that only my backend can vouch for who is looking at the referral widget

  Background:
    Given the application is running
    And a company has signed itself up

  Scenario: The Owner reads the secret, and the read is audited
    Given I am that company's Owner
    When I send a GET request to "/api/v1/tenants/widget-secret" with that token
    Then the response status should be 200
    And the response holds a 64-character hex secret
    And it is the secret Event Ingestion receives
    And the database does not hold it in plain text
    And the read is audit-logged with the Owner as actor

  Scenario: A member without api_keys:manage is refused
    Given I am a member of that company without api_keys:manage
    When I send a GET request to "/api/v1/tenants/widget-secret" with that token
    Then the response status should be 403

  Scenario: The secret is in no other answer
    Given I am that company's Owner
    When I send a GET request to "/api/v1/tenants/profile" with that token
    Then the response status should be 200
    And the response should not contain a "widget_token_secret" field

  Scenario: Rotation replaces the secret, and the old one keeps working for an hour
    Given I am that company's Owner
    And I have read the current secret
    When I send a POST request to "/api/v1/tenants/widget-secret/rotate" with that token
    Then the response status should be 200
    And the response holds a 64-character hex secret
    And it differs from the secret before the rotation
    And Event Ingestion receives the new secret and the previous one until about an hour from now
    And "tenant.widget_secret_rotated" is queued for that company without the secret
