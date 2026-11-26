@tenant-provisioning
Feature: Tenant provisioning by a Super Admin (US1.1.1)
  As a Super Admin
  I want to provision a new tenant from the platform console
  So that a client can start using the platform

  The Super Admin is never a member of the client's tenant (Product Spec R-ACT-02), so the tenant is
  created without an Owner and the client's Owner joins through an OWNER invitation.

  Background:
    Given the application is running

@us-1.1.1
@ac-us-1.1.1-1
@ac-us-1.1.1-2
@ac-us-1.1.1-3
@evidence-conflicting
  Scenario: Current provisioning creates a pending Owner invitation instead of an invited first Owner
    Given I am signed in as a Super Admin
    When I create the tenant "Acme Provisioned" for the owner "owner-prov@acme.com"
    Then the response status should be 201
    # E1 D15: a new tenant is unverified until its Owner opens a KYB session.
    And the response holds an active tenant "Acme Provisioned" whose verification is "unverified"
    And the response holds a pending "owner" invitation for "owner-prov@acme.com"
    And the response carries neither the widget token secret nor the invitation token hash
    And the new tenant has no members yet
    And the new tenant has exactly one pending "owner" invitation for "owner-prov@acme.com"
    And "tenant.created" is queued in the outbox for the new tenant
    And the creation of the new tenant is audit-logged with the Super Admin as actor

@extension
  Scenario: The invited Owner accepts and becomes the tenant's Owner
    Given I am signed in as a Super Admin
    And I create the tenant "Acme Joined" for the owner "owner-join@acme.com"
    And the Owner's invitation link carries the token "bdd-prov-invite-token"
    And "owner-join@acme.com" is signed in with the Ory identity "kratos-prov-owner"
    When I send a POST request to "/api/v1/invitations/public/bdd-prov-invite-token/accept" with that token
    Then the response status should be 200
    And "owner-join@acme.com" is the "owner" of the new tenant

@extension
  Scenario: A taken slug is refused and nothing is created
    Given I am signed in as a Super Admin
    And I create the tenant "Acme Twice" for the owner "owner-twice@acme.com"
    When I create another tenant with the same slug for the owner "owner-other@acme.com"
    Then the response status should be 409
    And the response should contain errorCode "duplicate_resource"
    And no invitation exists for "owner-other@acme.com"

@extension
  Scenario: Two companies with the same name can both sign up themselves
    When a company named "bdd-prov same" signs up through the Ory sign-up hook
    And another company named "bdd-prov same" signs up through the Ory sign-up hook
    Then both sign-ups created a tenant
    And the second tenant's slug is the first one's plus a 6-character suffix

@extension
  Scenario: An invalid owner email is refused
    Given I am signed in as a Super Admin
    When I send a POST request to "/api/v1/admin/tenants" with body:
      """
      { "name": "Acme Invalid", "owner_email": "not-an-email" }
      """
    Then the response status should be 400

@extension
  Scenario: A tenant Owner without the platform grant is refused
    Given I am signed in as a tenant Owner without the platform grant
    When I create the tenant "Acme Forbidden" for the owner "owner-forbidden@acme.com"
    Then the response status should be 403
    And no invitation exists for "owner-forbidden@acme.com"

@extension
  Scenario: A service token cannot create tenants
    Given I have a service token for tenant "default-tenant"
    When I create the tenant "Acme Service" for the owner "owner-service@acme.com"
    Then the response status should be 403
    And no invitation exists for "owner-service@acme.com"

  @public-endpoint
@extension
  Scenario: Creating a tenant requires authentication
    When I send a POST request to "/api/v1/admin/tenants" without any token
    Then the response status should be 401
