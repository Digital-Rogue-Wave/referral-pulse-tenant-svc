# Implement Tenant Service

## Summary

Implement the Tenant Service, a core microservice responsible for multi-tenancy, account management, team collaboration, and billing. This service acts as the foundation for the Referral Pulse platform, handling organization lifecycle and access control.

## Problem Statement

The platform requires a dedicated service to manage tenants (organizations), their settings, team members, and subscription status. Currently, this functionality is defined in the backlog and architecture documents but not yet implemented.

## Proposed Solution

Develop the Tenant Service using NestJS, TypeORM, and PostgreSQL, following the specifications outlined in `referral-pulse-svc-template/docs/backlogs/Tenant-service-backlog.md` and `referral-pulse-svc-template/docs/microservices-architecture.md`.

The implementation will be divided into 6 key capabilities corresponding to the defined Epics:

1. **Tenant Management**: Core organization lifecycle (create, read, update).
2. **Team & Access Management**: Member invitations, roles, and RBAC.
3. **Settings & Configuration**: General settings, branding, and API keys.
4. **Billing & Subscription**: Subscription management via Stripe.
5. **Plan Management**: Definition of plans and limits.
6. **Account Lifecycle**: Suspension, locking, data export, and deletion.

## Impact

- **Users**: Will be able to sign up, create organizations, invite team members, and manage their subscriptions.
- **System**: Establishes the multi-tenancy model used by all other services.
- **Security**: Centralizes authentication and authorization logic for tenant access.

## Workflows

### 1. User Authentication Flow (Epic 1)

Triggered when a user logs in via Ory Hydra and Kratos.

```mermaid
sequenceDiagram
    participant User
    participant Application
    participant Hydra as Ory Hydra
    participant Kratos as Ory Kratos

    User->>Application: Request Access
    Application->>Hydra: Authorization Request
    Hydra->>Kratos: Login Challenge
    Kratos->>User: Login Page
    User->>Kratos: Login Credentials
    Kratos->>Hydra: Login Response

    alt User Consent Required
        Hydra->>Kratos: Consent Challenge
        Kratos->>User: Consent Request
        User->>Kratos: Consent Response
        Kratos->>Hydra: User Consent Granted
    end

    Hydra->>Application: Authorization Code
    Application->>Hydra: Token Request
    Hydra->>Application: Access Token and ID Token
    Application->>User: Granted Access
```

### 2. Tenant Creation (Epic 1)

Triggered when a user registers and creates a new organization. This flow assumes the user has successfully completed the **User Authentication Flow** and has a valid session/token.

**Endpoint**: `POST /tenants`
**Payload**: `CreateTenantDto` (multipart/form-data)

- `data`: JSON string of `CreateTenantDto`
- `file`: Optional image file for logo

**Implementation Steps**:

1.  **Validation**: Validate `CreateTenantDto`.
2.  **Slug Generation**: If not provided, generate a slug from the tenant name.
3.  **Uniqueness Check**: Ensure the slug is unique in the database.
4.  **File Upload**: If a file is provided, upload it via `FilesService` and set the `image` URL.
5.  **Persistence**: Save the new `TenantEntity` to the database with default settings.
6.  **Audit Log**: Log the `TENANT_CREATED` action via `AuditService`.
7.  **Event Publishing**: Publish a `tenant.created` event to SNS (`tenant-events` topic).

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant TS as Tenant Service
    participant DB as Database
    participant S3 as AWS S3
    participant Keto as Ory Keto
    participant Audit as Audit Service
    participant SNS as Event Bus (SNS)

    Note over User: User submits create tenant form
    User->>TS: POST /tenants (Multipart)
    TS->>TS: Validate DTO & Generate Slug
    TS->>DB: Check Slug Uniqueness
    alt File Provided
        TS->>S3: Upload Logo
        S3-->>TS: Return Image URL
    end
    TS->>DB: Save Tenant Entity
    TS->>Keto: Create Relation (User is Owner of Tenant)
    TS->>Audit: Log 'TENANT_CREATED'
    TS->>SNS: Publish 'tenant.created'
    TS-->>User: Return Created Tenant
```

### 3. Tenant Update & Logo Upload (Epic 1)

Triggered when a user updates their organization profile or uploads a logo.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant TS as Tenant Service
    participant Keto as Ory Keto
    participant S3 as AWS S3
    participant DB as Database
    participant Audit as Audit Service
    participant SNS as Event Bus (SNS)

    Note over User: Event: User Updates Profile
    User->>TS: GET /files/presigned/put (Logo)
    TS->>Keto: Check Permission (update)
    TS->>S3: Generate Presigned URL
    S3-->>TS: URL
    TS-->>User: Return Presigned URL
    User->>S3: Upload Image
    User->>TS: PUT /tenants/:id (Update Profile + Logo URL)
    TS->>Keto: Check Permission (update)
    TS->>DB: Update Tenant Entity
    TS->>Audit: Log 'TENANT_UPDATED'
    TS->>SNS: Publish 'tenant.updated'
    TS-->>User: Return Updated Profile
```

### 4. Team Member Invitation (Epic 2)

Triggered when an organization owner invites a new team member. The invitee must complete the **User Authentication Flow** (Register/Login via Kratos) to accept the invitation.

#### 4.1 Send Invitation

**Endpoint**: `POST /tenants/:id/invites`
**Payload**: `{ email: string, role: string }`

1.  **Permission Check**: Verify subject has permission to invite members (`invite` relation in Keto).
2.  **Token Generation**: Generate a secure, unique invitation token (e.g., 32-byte hex).
3.  **Persistence**: Save the `InvitationEntity` with status `PENDING` and an expiration date (default 7 days).
4.  **Notification**: Trigger the Notification Service to send an email with the "magic link" containing the token.
5.  **Audit**: Log `INVITATION_CREATED`.

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant Keto as Ory Keto
    participant DB as Database
    participant Mail as Notification Service
    participant Invitee

    Note over Admin: Admin invites new member
    Admin->>TS: POST /tenants/:id/invites
    TS->>Keto: Check Permission (invite)
    TS->>DB: Create Invitation (Token, PENDING)
    TS->>Mail: Send Invitation Email
    Mail-->>Invitee: Email with Magic Link
    TS-->>Admin: Success
```

#### 4.2 Accept Invitation

**Endpoint**: `POST /invites/accept`
**Payload**: `{ token: string }`

**Pre-requisite**: User clicks the link -> Frontend calls `GET /invites/:token/validate` -> User Registers/Logs in.

1.  **Validation**: Ensure token exists, status is `PENDING`, and `expiresAt` > now.
2.  **Association**: Create a `TeamMemberEntity` linking the authenticated `userId` to the `tenantId` with the specified `role`.
3.  **Status Update**: Update invitation status to `ACCEPTED`.
4.  **Authorization Update**: Update Ory Keto to grant the user access to the tenant (add tuple: `tenant:id#member@user:id`).
5.  **Audit**: Log `INVITATION_ACCEPTED`.

```mermaid
sequenceDiagram
    autonumber
    actor Invitee
    participant Kratos as Ory Kratos
    participant TS as Tenant Service
    participant DB as Database
    participant Keto as Ory Keto

    Note over Invitee: User clicks link & authenticates
    Invitee->>Kratos: Register / Login
    Invitee->>TS: POST /invites/accept
    TS->>DB: Validate Token & Expiry
    TS->>DB: Update Invitation (ACCEPTED)
    TS->>DB: Create Team Member
    TS->>Keto: Add Relation (member)
    TS-->>Invitee: Success (Joined Tenant)
```

#### 4.3 Reject Invitation

**Endpoint**: `POST /invites/reject`
**Payload**: `{ token: string }`

Allows an invitee to explicit decline an invitation.

1.  **Validation**: Ensure token exists and is `PENDING`.
2.  **Status Update**: Update invitation status to `REJECTED`.
3.  **Audit**: Log `INVITATION_REJECTED`.

```mermaid
sequenceDiagram
    autonumber
    actor Invitee
    participant TS as Tenant Service
    participant DB as Database

    Note over Invitee: User declines invitation
    Invitee->>TS: POST /invites/reject
    TS->>DB: Update Invitation (REJECTED)
    TS-->>Invitee: Success
```

#### 4.4 Cancel Invitation

**Endpoint**: `DELETE /tenants/:id/invites/:invitationId` (or `PATCH .../revoke`)

Allows the tenant admin to revoke an invitation before it is accepted.

1.  **Permission Check**: Verify subject has permission to manage invites.
2.  **Status Update**: Update invitation status to `REVOKED`.
3.  **Audit**: Log `INVITATION_REVOKED`.

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant Keto as Ory Keto
    participant DB as Database

    Note over Admin: Admin revokes pending invite
    Admin->>TS: DELETE /tenants/:id/invites/:invitationId
    TS->>Keto: Check Permission
    TS->>DB: Update Invitation (REVOKED)
    TS-->>Admin: Success
```

### 5. API Key Management (Epic 3)

This epic covers the lifecycle of API keys, allowing tenants to integrate with external systems securely. It includes generation, status management (stop/start), updates, and deletion. All actions are strictly gated by Ory Keto permissions.

#### 5.1 API Key Generation

Triggered when a tenant admin creates a new API key for external integration.

**Endpoint**: `POST /tenants/:tenantId/api-keys`
**Payload**: `{ name: string, scopes: string[] }`

**Implementation Steps**:

1.  **Permission Check**: Verify subject has `create_api_key` permission on the tenant via Keto.
2.  **Generation**: Generate a secure key (e.g., `sk_live_...`) using a cryptographically secure random generator.
3.  **Hashing**: Hash the key using `bcrypt` or `Argon2` before storage. **Never store raw keys.**
4.  **Persistence**: Save the hash, metadata (name, scopes), and owner ID to the database.
5.  **Audit**: Log `API_KEY_CREATED` action.
6.  **Response**: Return the **raw key** to the user. This is the only time it will be visible.

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant Keto as Ory Keto
    participant DB as Database
    participant Audit as Audit Service

    Note over Admin: Admin requests new API Key
    Admin->>TS: POST /tenants/:id/api-keys
    TS->>Keto: Check Permission (create_api_key)
    alt Permission Denied
        TS-->>Admin: 403 Forbidden
    else Permission Granted
        TS->>TS: Generate Secure Key (Prefix + Random)
        TS->>TS: Hash Key (bcrypt)
        TS->>DB: Save Key Hash & Permissions
        TS->>Audit: Log 'API_KEY_CREATED'
        TS-->>Admin: Return Raw Key (Once only)
    end
```

#### 5.2 API Key Lifecycle (Update, Stop, Delete)

Manages the state and properties of existing API keys.

- **Update**: Modify name or scopes.
- **Stop (Revoke)**: Immediately disable the key without deleting it.
- **Delete**: Permanently remove the key.

**Endpoints**:

- `PATCH /tenants/:tenantId/api-keys/:keyId` (Update details)
- `PATCH /tenants/:tenantId/api-keys/:keyId/status` (Change status: `ACTIVE` <-> `STOPPED`)
- `DELETE /tenants/:tenantId/api-keys/:keyId` (Delete)

**Implementation Steps**:

1.  **Permission Check**: Verify subject has `update_api_key` or `delete_api_key` permission via Keto.
2.  **Action**: Perform the requested database update or deletion.
3.  **Audit**: Log the specific action (`API_KEY_UPDATED`, `API_KEY_STOPPED`, `API_KEY_DELETED`).

##### Update API Key

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant Keto as Ory Keto
    participant DB as Database
    participant Audit as Audit Service

    Note over Admin: Admin updates API Key details
    Admin->>TS: PATCH /tenants/:tenantId/api-keys/:keyId
    TS->>Keto: Check Permission (update_api_key)
    alt Permission Denied
        TS-->>Admin: 403 Forbidden
    else Permission Granted
        TS->>DB: Update Name/Scopes
        TS->>Audit: Log 'API_KEY_UPDATED'
        TS-->>Admin: Success
    end
```

##### Stop/Revoke API Key

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant Keto as Ory Keto
    participant DB as Database
    participant Audit as Audit Service

    Note over Admin: Admin revokes API Key
    Admin->>TS: PATCH /tenants/:tenantId/api-keys/:keyId/status
    TS->>Keto: Check Permission (update_api_key)
    alt Permission Denied
        TS-->>Admin: 403 Forbidden
    else Permission Granted
        TS->>DB: Set Status = STOPPED
        TS->>Audit: Log 'API_KEY_STOPPED'
        TS-->>Admin: Success
    end
```

##### Delete API Key

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant Keto as Ory Keto
    participant DB as Database
    participant Audit as Audit Service

    Note over Admin: Admin deletes API Key
    Admin->>TS: DELETE /tenants/:tenantId/api-keys/:keyId
    TS->>Keto: Check Permission (delete_api_key)
    alt Permission Denied
        TS-->>Admin: 403 Forbidden
    else Permission Granted
        TS->>DB: Hard Delete Key
        TS->>Audit: Log 'API_KEY_DELETED'
        TS-->>Admin: Success
    end
```

### 6. Subscription Checkout (Epic 4)

Triggered when a tenant subscribes to a paid plan or upgrades their existing subscription. This flow utilizes Stripe Checkout for secure payment processing.

**Endpoints**:

- `POST /tenants/:tenantId/subscription/checkout` (Create Session)
- `POST /tenants/webhooks/stripe` (Handle Events)

**Implementation Steps**:

1.  **Plan Selection**: Admin selects a billing plan (Free, Starter, Growth, Enterprise).
2.  **Session Creation**: Tenant Service calls Stripe API to create a `checkout.session`.
    - Metadata includes `tenantId` and `planId`.
    - Success/Cancel URLs point back to the frontend application.
3.  **Redirection**: Service returns the `sessionId` or `url` to the frontend, which redirects the user to Stripe.
4.  **Payment Processing**: User completes payment on Stripe's hosted page.
5.  **Webhook Handling**: Stripe sends `checkout.session.completed` event to the webhook endpoint.
    - **Verify Signature**: Ensure request is from Stripe.
    - **Update Tenant**: Set `billing_plan`, `subscription_status`='active', and `stripe_customer_id`.
    - **Audit**: Log `SUBSCRIPTION_UPDATED`.
6.  **Event Publishing**: Publish `subscription.changed` to SNS.

##### Free Plan (Downgrade/Selection)

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant DB as Database
    participant SNS as Event Bus (SNS)
    participant Stripe as Stripe API

    Note over Admin: Admin selects Free Plan
    Admin->>TS: POST .../subscription/checkout (Plan=Free)
    TS->>DB: Update Tenant (Plan=Free)
    TS->>Stripe: Cancel Active Subscription (if any)
    TS->>SNS: Publish 'subscription.changed'
    TS-->>Admin: Success (No Payment Required)
```

##### Starter Plan Checkout

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant Stripe as Stripe API
    participant DB as Database
    participant SNS as Event Bus (SNS)

    Note over Admin: Admin selects Starter Plan
    Admin->>TS: POST .../subscription/checkout (Plan=Starter)
    TS->>Stripe: Create Checkout Session (metadata: tenantId, plan: Starter)
    Stripe-->>TS: Session URL
    TS-->>Admin: Redirect to Stripe

    Note over Admin: Admin completes payment
    Stripe->>TS: Webhook (checkout.session.completed)
    TS->>TS: Verify Webhook Signature
    TS->>DB: Update Tenant (Plan=Starter, Status=Active)
    TS->>SNS: Publish 'subscription.changed'
    TS-->>Stripe: 200 OK
```

##### Growth Plan Checkout

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant Stripe as Stripe API
    participant DB as Database
    participant SNS as Event Bus (SNS)

    Note over Admin: Admin selects Growth Plan
    Admin->>TS: POST .../subscription/checkout (Plan=Growth)
    TS->>Stripe: Create Checkout Session (metadata: tenantId, plan: Growth)
    Stripe-->>TS: Session URL
    TS-->>Admin: Redirect to Stripe

    Note over Admin: Admin completes payment
    Stripe->>TS: Webhook (checkout.session.completed)
    TS->>TS: Verify Webhook Signature
    TS->>DB: Update Tenant (Plan=Growth, Status=Active)
    TS->>SNS: Publish 'subscription.changed'
    TS-->>Stripe: 200 OK
```

##### Enterprise Plan Checkout

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant TS as Tenant Service
    participant Stripe as Stripe API
    participant DB as Database
    participant SNS as Event Bus (SNS)

    Note over Admin: Admin selects Enterprise Plan
    Admin->>TS: POST .../subscription/checkout (Plan=Enterprise)
    TS->>Stripe: Create Checkout Session (metadata: tenantId, plan: Enterprise)
    Stripe-->>TS: Session URL
    TS-->>Admin: Redirect to Stripe

    Note over Admin: Admin completes payment
    Stripe->>TS: Webhook (checkout.session.completed)
    TS->>TS: Verify Webhook Signature
    TS->>DB: Update Tenant (Plan=Enterprise, Status=Active)
    TS->>SNS: Publish 'subscription.changed'
    TS-->>Stripe: 200 OK
```

### 7. Plan Limit Enforcement (Epic 5)

Triggered when a tenant attempts an action that consumes a limited resource (e.g., creating a campaign).

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant TS as Tenant Service
    participant Redis as Redis Cache
    participant DB as Database

    Note over User: User attempts to create resource
    User->>TS: POST /campaigns
    TS->>Redis: Get Current Usage & Plan Limits
    alt Usage < Limit
        TS->>DB: Create Resource
        TS->>Redis: Increment Usage Counter
        TS-->>User: Success
    else Usage >= Limit
        TS-->>User: 403 Forbidden (Limit Exceeded)
    end
```

### 8. Tenant Deletion (Epic 6)

Triggered when a tenant owner requests account deletion. This implements a 30-day grace period to allow recovery before permanent deletion.

**Endpoints**:

- `POST /tenants/:id/schedule-deletion` (Schedule deletion)
- `POST /tenants/:id/cancel-deletion` (Cancel scheduled deletion)

**Implementation Steps**:

#### 8.1 Schedule Deletion

1.  **Permission Check**: Verify subject has `DELETE` permission on the tenant via Keto.
2.  **Password Verification**: Verify the owner's password via Kratos for security.
3.  **Status Check**: Ensure deletion is not already scheduled.
4.  **Date Calculation**: Calculate execution date (30 days from now).
5.  **Status Update**: Update tenant status to `DELETION_SCHEDULED` and set `deletionScheduledAt` and `deletionReason`.
6.  **Event Emission**: Emit `tenant.deletion.scheduled` event for side effects (Audit, SNS, Notification, Job Queue).

```mermaid
sequenceDiagram
    autonumber
    actor Owner
    participant TS as Tenant Service
    participant Keto as Ory Keto
    participant Kratos as Ory Kratos
    participant DB as Database
    participant Audit as Audit Service
    participant SNS as Event Bus (SNS)
    participant Mail as Notification Service

    Note over Owner: Owner requests deletion
    Owner->>TS: POST /tenants/:id/schedule-deletion
    TS->>Keto: Check Permission (delete)
    alt Permission Denied
        TS-->>Owner: 403 Forbidden
    else Permission Granted
        TS->>Kratos: Verify Password
        alt Invalid Password
            TS-->>Owner: 401 Unauthorized
        else Password Valid
            TS->>DB: Check if already scheduled
            alt Already Scheduled
                TS-->>Owner: 409 Conflict
            else Not Scheduled
                TS->>TS: Calculate Execution Date (+30 days)
                TS->>DB: Update Status to DELETION_SCHEDULED
                TS->>Audit: Log 'TENANT_DELETION_SCHEDULED'
                TS->>SNS: Publish 'tenant.deletion.scheduled'
                TS->>Mail: Send Confirmation Email
                TS-->>Owner: Success (scheduledAt, executionDate)
            end
        end
    end
```

#### 8.2 Cancel Deletion

Allows the owner to cancel a scheduled deletion before the 30-day grace period expires.

1.  **Permission Check**: Verify subject has `UPDATE` permission on the tenant.
2.  **Password Verification**: Verify the owner's password via Kratos.
3.  **Status Check**: Ensure deletion is currently scheduled.
4.  **Status Restore**: Update tenant status back to `ACTIVE` and clear deletion fields.
5.  **Event Emission**: Emit `tenant.deletion.cancelled` event for side effects.

```mermaid
sequenceDiagram
    autonumber
    actor Owner
    participant TS as Tenant Service
    participant Keto as Ory Keto
    participant Kratos as Ory Kratos
    participant DB as Database
    participant Audit as Audit Service
    participant SNS as Event Bus (SNS)
    participant Mail as Notification Service

    Note over Owner: Owner cancels deletion
    Owner->>TS: POST /tenants/:id/cancel-deletion
    TS->>Keto: Check Permission (update)
    alt Permission Denied
        TS-->>Owner: 403 Forbidden
    else Permission Granted
        TS->>Kratos: Verify Password
        alt Invalid Password
            TS-->>Owner: 401 Unauthorized
        else Password Valid
            TS->>DB: Check if deletion is scheduled
            alt Not Scheduled
                TS-->>Owner: 400 Bad Request
            else Deletion Scheduled
                TS->>DB: Restore Status to ACTIVE
                TS->>Audit: Log 'TENANT_DELETION_CANCELLED'
                TS->>SNS: Publish 'tenant.deletion.cancelled'
                TS->>Mail: Send Cancellation Confirmation
                TS-->>Owner: Success
            end
        end
    end
```

#### 8.3 Execute Deletion (Background Job)

This is executed by a scheduled background job after the 30-day grace period.

1.  **Status Verification**: Ensure tenant status is `DELETION_SCHEDULED`.
2.  **Date Verification**: Verify 30 days have passed since `deletionScheduledAt`.
3.  **Event Emission**: Emit `tenant.deleted` event BEFORE deletion for cleanup tasks.
4.  **Hard Delete**: Permanently delete the tenant from the database.

```mermaid
sequenceDiagram
    autonumber
    participant Bull as Job Queue
    participant TS as Tenant Service
    participant DB as Database
    participant Audit as Audit Service
    participant SNS as Event Bus (SNS)
    participant Keto as Ory Keto
    participant S3 as AWS S3

    Note over Bull: 30 Days Later
    Bull->>TS: Execute Deletion Job (tenantId)
    TS->>DB: Fetch Tenant
    TS->>TS: Verify Status = DELETION_SCHEDULED
    TS->>TS: Verify 30 Days Passed
    alt Verification Failed
        TS-->>Bull: Error (Job Failed)
    else Verification Passed
        TS->>Audit: Log 'TENANT_DELETED'
        TS->>SNS: Publish 'tenant.deleted'
        Note over SNS: Other services listen to this event
        SNS->>Keto: Remove All Tenant Relations
        SNS->>S3: Delete Tenant Files
        TS->>DB: Hard Delete Tenant
        TS-->>Bull: Success
    end
```

**Event Listeners**:

The `TenantListener` handles the following events:

- `tenant.deletion.scheduled`: Logs audit, publishes SNS event, sends notification email, schedules background job.
- `tenant.deletion.cancelled`: Logs audit, publishes SNS event, sends notification email, cancels background job.
- `tenant.deleted`: Logs audit, publishes SNS event for cleanup (Keto relations, S3 files, other services).

**Security Considerations**:

- Password verification is required for both scheduling and canceling deletion.
- Only users with `DELETE` permission (typically the owner) can schedule deletion.
- The 30-day grace period allows recovery from accidental deletion requests.
- Audit logs capture all deletion-related actions for compliance.
