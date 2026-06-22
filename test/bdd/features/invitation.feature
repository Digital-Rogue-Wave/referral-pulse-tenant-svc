@invitations
Feature: Team Invitations
  As an authenticated tenant
  I want to invite teammates and manage invitations
  So that new members can join the tenant

  Background:
    Given the application is running
    And I have a valid JWT for tenant "default-tenant"

  @needs-clean-invitations
  Scenario: Create a pending invitation
    When I send a POST request to "/api/v1/invitations" with body:
      """
      { "email": "newteammate@acme.com", "role": "OPERATOR" }
      """
    Then the response status should be 201
    And the response should contain a "email" field
    And the response should contain a "status" field

  Scenario: List invitations is paginated
    When I send a GET request to "/api/v1/invitations" with that token
    Then the response status should be 200
    And the response should contain a "data" field

  @public-endpoint
  Scenario: Validating an unknown invitation token returns 404
    When I send a GET request to "/api/v1/invitations/public/nonexistent-token" without any token
    Then the response status should be 404

  @public-endpoint
  Scenario: Creating an invitation requires authentication
    When I send a POST request to "/api/v1/invitations" without any token
    Then the response status should be 401

  @public-endpoint @needs-pending-invitation
  Scenario: Validate a pending invitation token
    When I send a GET request to "/api/v1/invitations/public/bdd-invite-token" without any token
    Then the response status should be 200
    And the response should contain a "email" field
    And the response should contain a "role" field

  @needs-pending-invitation
  Scenario: Accept an invitation with the matching Ory identity provisions membership
    Given I have an invitee token for email "invitee-bdd@acme.com"
    When I send a POST request to "/api/v1/invitations/public/bdd-invite-token/accept" with that token
    Then the response status should be 200
    And the response should contain a "id" field
    And the response should contain a "tenantId" field

  @needs-pending-invitation
  Scenario: Accepting with a non-matching email is forbidden
    Given I have an invitee token for email "intruder-bdd@acme.com"
    When I send a POST request to "/api/v1/invitations/public/bdd-invite-token/accept" with that token
    Then the response status should be 403
