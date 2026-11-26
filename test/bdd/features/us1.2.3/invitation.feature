@invitations
Feature: Team invitations (US1.2.3)
  As an authenticated tenant
  I want to invite teammates and manage invitations
  So that new members can join the tenant

  Background:
    Given the application is running
    And I have a valid JWT for tenant "default-tenant"

  @needs-clean-invitations
@us-1.2.3
@ac-us-1.2.3-2
@evidence-partial
  Scenario: Create a pending invitation
    When I send a POST request to "/api/v1/invitations" with body:
      """
      { "email": "newteammate@acme.com", "role": "operator" }
      """
    Then the response status should be 201
    And the response should contain a "email" field
    And the response should contain a "status" field

  @needs-clean-invitations
@us-1.2.3
@ac-us-1.2.3-1
@ac-us-1.2.3-2
@evidence-partial
  Scenario: Invite a user through the v5.2 route (API §3.17, US1.2.3)
    When I send a POST request to "/api/v1/users/invite" with body:
      """
      { "email": "newteammate@acme.com", "role": "operator" }
      """
    Then the response status should be 201
    And the response should contain a "email" field
    And the response should contain a "status" field

  @public-endpoint
@extension
  Scenario: Inviting a user requires authentication
    When I send a POST request to "/api/v1/users/invite" without any token
    Then the response status should be 401

@extension
  Scenario: List invitations is paginated
    When I send a GET request to "/api/v1/invitations" with that token
    Then the response status should be 200
    And the response should contain a "data" field

  @public-endpoint
@extension
  Scenario: Validating an unknown invitation token returns 404
    When I send a GET request to "/api/v1/invitations/public/nonexistent-token" without any token
    Then the response status should be 404

  @public-endpoint
@extension
  Scenario: Creating an invitation requires authentication
    When I send a POST request to "/api/v1/invitations" without any token
    Then the response status should be 401

  @public-endpoint @needs-pending-invitation
@extension
  Scenario: Validate a pending invitation token
    When I send a GET request to "/api/v1/invitations/public/bdd-invite-token" without any token
    Then the response status should be 200
    And the response should contain a "email" field
    And the response should contain a "role" field
    And the response should not contain a "tenant_id" field
    And the response should not contain a "token_hash" field

  @needs-pending-invitation
@us-1.2.3
@ac-us-1.2.3-2
@evidence-partial
  Scenario: Accept an invitation with the matching Ory identity provisions membership
    Given I have an invitee token for email "invitee-bdd@acme.com"
    When I send a POST request to "/api/v1/invitations/public/bdd-invite-token/accept" with that token
    Then the response status should be 200
    And the response should contain a "id" field
    And the response should contain a "tenant_id" field

  @needs-pending-invitation
@extension
  Scenario: Accepting with a non-matching email is forbidden
    Given I have an invitee token for email "intruder-bdd@acme.com"
    When I send a POST request to "/api/v1/invitations/public/bdd-invite-token/accept" with that token
    Then the response status should be 403
