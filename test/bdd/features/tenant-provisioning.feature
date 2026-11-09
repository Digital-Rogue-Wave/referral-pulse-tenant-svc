@tenant-provisioning
Feature: Tenant provisioning by a Super Admin (US1.1.1)
  As a Super Admin
  I want to provision a new tenant from the platform console
  So that a client can start using the platform

  The Super Admin is never a member of the client's tenant (Product Spec R-ACT-02), so the tenant is
  created without an Owner and the client's Owner joins through an OWNER invitation.

  Background:
    Given the application is running

  Scenario: A Super Admin creates a tenant and invites its Owner
    Given I am signed in as a Super Admin
    When I create the tenant "Acme Provisioned" for the owner "owner-prov@acme.com"
    Then the response status should be 201
    And the response holds an active tenant "Acme Provisioned" whose verification is "pending"
    And the response holds a pending "OWNER" invitation for "owner-prov@acme.com"
    And the response carries neither the widget token secret nor the invitation token hash
    And the new tenant has no members yet
    And the new tenant has exactly one pending "OWNER" invitation for "owner-prov@acme.com"
    And "tenant.created" is queued in the outbox for the new tenant
    And the creation of the new tenant is audit-logged with the Super Admin as actor

  Scenario: The invited Owner accepts and becomes the tenant's Owner
    Given I am signed in as a Super Admin
    And I create the tenant "Acme Joined" for the owner "owner-join@acme.com"
    And the Owner's invitation link carries the token "bdd-prov-invite-token"
    And "owner-join@acme.com" is signed in with the Ory identity "kratos-prov-owner"
    When I send a POST request to "/api/v1/invitations/public/bdd-prov-invite-token/accept" with that token
    Then the response status should be 200
    And "owner-join@acme.com" is the "OWNER" of the new tenant

  Scenario: A taken slug is refused and nothing is created
    Given I am signed in as a Super Admin
    And I create the tenant "Acme Twice" for the owner "owner-twice@acme.com"
    When I create another tenant with the same slug for the owner "owner-other@acme.com"
    Then the response status should be 409
    And the response should contain errorCode "duplicate_resource"
    And no invitation exists for "owner-other@acme.com"

  Scenario: Two companies with the same name can both sign up themselves
    When a company named "bdd-prov same" signs up through the Ory sign-up hook
    And another company named "bdd-prov same" signs up through the Ory sign-up hook
    Then both sign-ups created a tenant
    And the second tenant's slug is the first one's plus a 6-character suffix

  Scenario: An invalid owner email is refused
    Given I am signed in as a Super Admin
    When I send a POST request to "/api/v1/admin/tenants" with body:
      """
      { "name": "Acme Invalid", "owner_email": "not-an-email" }
      """
    Then the response status should be 400

  Scenario: A tenant Owner without the platform grant is refused
    Given I am signed in as a tenant Owner without the platform grant
    When I create the tenant "Acme Forbidden" for the owner "owner-forbidden@acme.com"
    Then the response status should be 403
    And no invitation exists for "owner-forbidden@acme.com"

  Scenario: A service token cannot create tenants
    Given I have a service token for tenant "default-tenant"
    When I create the tenant "Acme Service" for the owner "owner-service@acme.com"
    Then the response status should be 403
    And no invitation exists for "owner-service@acme.com"

  @public-endpoint
  Scenario: Creating a tenant requires authentication
    When I send a POST request to "/api/v1/admin/tenants" without any token
    Then the response status should be 401
