# Product Backlog: Tenant Service
## Referral Marketing SaaS Platform

**Service:** Tenant Service  
**Version:** 1.0  
**Created:** December 2024

---

# Epics Overview

| Epic ID | Epic Name | Priority | Stories |
|---------|-----------|----------|---------|
| E-TEN-01 | Tenant Management | P0 - Critical | 4 |
| E-TEN-02 | Team & Access Management | P0 - Critical | 7 |
| E-TEN-03 | Settings & Configuration | P1 - High | 5 |
| E-TEN-04 | Billing & Subscription | P0 - Critical | 8 |
| E-TEN-05 | Plan Management | P1 - High | 5 |
| E-TEN-06 | Account Lifecycle | P1 - High | 6 |
| E-TEN-07 | Payment Enforcement | P0 - Critical | 5 |
| E-TEN-08 | GDPR Compliance | P0 - Critical | 6 |
| E-TEN-09 | Company Onboarding & Verification 🆕 | P0 - Critical | 4 |

**Note:** Custom Domain and Subdomain Management deferred to V1.1 (using wildcard subdomain for MVP)

---

# E-TEN-01: Tenant Management

> **Epic Description:** Core tenant (organization) creation, configuration, and management capabilities.

## User Stories

### US-TEN-001: Tenant Registration
**As a** new user completing signup  
**I want to** have my organization automatically created  
**So that** I can start using the platform immediately

**Acceptance Criteria:**
- [ ] Tenant created after Ory signup completion
- [ ] Default settings applied based on signup source
- [ ] Unique subdomain generated (acme.referral.io)
- [ ] Owner role assigned to signup user
- [ ] Welcome email triggered
- [ ] Tenant appears in admin dashboard

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-001-1 | Create Tenant entity with TypeORM | 2h |
| T-001-2 | Implement POST /tenants endpoint | 3h |
| T-001-3 | Add Ory webhook listener for signup events | 4h |
| T-001-4 | Implement subdomain generation logic | 2h |
| T-001-5 | Create default settings factory | 2h |
| T-001-6 | Publish tenant.created event to SNS | 2h |
| T-001-7 | Write unit tests | 3h |
| T-001-8 | Write integration tests | 3h |

---

### US-TEN-002: View Tenant Profile
**As a** tenant admin  
**I want to** view my organization's profile  
**So that** I can see current configuration and status

**Acceptance Criteria:**
- [ ] Display tenant name, slug, creation date
- [ ] Show current plan and subscription status
- [ ] Display custom domain if configured
- [ ] Show team member count
- [ ] Display usage statistics summary

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-002-1 | Implement GET /tenants/:id endpoint | 2h |
| T-002-2 | Create TenantProfileDTO with computed fields | 2h |
| T-002-3 | Add usage stats aggregation query | 3h |
| T-002-4 | Implement tenant context guard | 2h |
| T-002-5 | Write unit tests | 2h |

---

### US-TEN-003: Update Tenant Profile
**As a** tenant admin  
**I want to** update my organization's profile  
**So that** I can keep information current

**Acceptance Criteria:**
- [ ] Edit tenant name
- [ ] Upload/change logo
- [ ] Update company details (address, VAT number)
- [ ] Changes reflected immediately
- [ ] Audit log entry created

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-003-1 | Implement PUT /tenants/:id endpoint | 2h |
| T-003-2 | Add logo upload to S3 with presigned URL | 3h |
| T-003-3 | Create UpdateTenantDTO with validation | 2h |
| T-003-4 | Implement audit logging | 2h |
| T-003-5 | Publish tenant.updated event | 1h |
| T-003-6 | Write unit tests | 2h |

---

### US-TEN-004: Tenant Dashboard Stats
**As a** tenant admin  
**I want to** see key metrics on my dashboard  
**So that** I can understand my referral program performance at a glance

**Acceptance Criteria:**
- [ ] Display active campaigns count
- [ ] Show total referrers
- [ ] Display total referrals (this month)
- [ ] Show total revenue generated
- [ ] Display pending payouts
- [ ] Show plan usage (% of limits)

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-004-1 | Implement GET /tenants/:id/stats endpoint | 3h |
| T-004-2 | Create cross-service stats aggregator (calls other services) | 4h |
| T-004-3 | Add Redis caching for stats (5 min TTL) | 2h |
| T-004-4 | Write unit tests | 2h |

---

# E-TEN-02: Team & Access Management

> **Epic Description:** Invite team members, manage roles and permissions, handle team collaboration.

## User Stories

### US-TEN-007: Invite Team Member
**As a** tenant admin  
**I want to** invite team members by email  
**So that** they can access and manage the referral program

**Acceptance Criteria:**
- [ ] Enter email and select role
- [ ] Send invitation email with magic link
- [ ] Invitation expires after 7 days
- [ ] Resend invitation option
- [ ] Cancel pending invitation
- [ ] Prevent duplicate invitations

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-007-1 | Create TeamMember entity with TypeORM | 2h |
| T-007-2 | Implement POST /tenants/:id/members endpoint | 3h |
| T-007-3 | Create invitation token generation (JWT) | 2h |
| T-007-4 | Integrate with Integration Service for email | 2h |
| T-007-5 | Implement invitation expiry logic | 2h |
| T-007-6 | Add resend/cancel invitation endpoints | 2h |
| T-007-7 | Publish member.invited event | 1h |
| T-007-8 | Write unit tests | 3h |

---

### US-TEN-008: Accept Team Invitation
**As an** invited user  
**I want to** accept the invitation and create my account  
**So that** I can access the tenant's workspace

**Acceptance Criteria:**
- [ ] Click invitation link in email
- [ ] If no Ory account, redirect to signup
- [ ] If existing Ory account, prompt to login
- [ ] After auth, join tenant with assigned role
- [ ] Redirect to tenant dashboard
- [ ] Invitation marked as accepted

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-008-1 | Implement GET /invitations/:token/validate endpoint | 2h |
| T-008-2 | Implement POST /invitations/:token/accept endpoint | 3h |
| T-008-3 | Handle Ory account creation/linking flow | 4h |
| T-008-4 | Update TeamMember status on acceptance | 2h |
| T-008-5 | Publish member.joined event | 1h |
| T-008-6 | Write integration tests | 3h |

---

### US-TEN-009: List Team Members
**As a** tenant admin  
**I want to** view all team members  
**So that** I can manage access to the workspace

**Acceptance Criteria:**
- [ ] Display list of active members
- [ ] Show pending invitations separately
- [ ] Display name, email, role, joined date
- [ ] Show last active timestamp
- [ ] Filter by role
- [ ] Search by name/email

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-009-1 | Implement GET /tenants/:id/members endpoint | 2h |
| T-009-2 | Add pagination support | 1h |
| T-009-3 | Add filtering and search | 2h |
| T-009-4 | Create TeamMemberDTO | 1h |
| T-009-5 | Write unit tests | 2h |

---

### US-TEN-010: Update Team Member Role
**As a** tenant admin  
**I want to** change a team member's role  
**So that** I can adjust their access level

**Acceptance Criteria:**
- [ ] Select new role from dropdown
- [ ] Cannot demote self if only admin
- [ ] Role change effective immediately
- [ ] Member notified of role change
- [ ] Audit log entry created

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-010-1 | Implement PUT /members/:id endpoint | 2h |
| T-010-2 | Add "last admin" protection logic | 2h |
| T-010-3 | Send role change notification | 1h |
| T-010-4 | Add audit logging | 1h |
| T-010-5 | Publish member.updated event | 1h |
| T-010-6 | Write unit tests | 2h |

---

### US-TEN-011: Remove Team Member
**As a** tenant admin  
**I want to** remove a team member  
**So that** they no longer have access

**Acceptance Criteria:**
- [ ] Confirm removal action
- [ ] Cannot remove self
- [ ] Cannot remove if only admin
- [ ] Access revoked immediately
- [ ] Member notified via email
- [ ] Member can still access own Ory account (other tenants)

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-011-1 | Implement DELETE /members/:id endpoint | 2h |
| T-011-2 | Add self-removal and last-admin protection | 2h |
| T-011-3 | Invalidate member's sessions for this tenant | 2h |
| T-011-4 | Send removal notification | 1h |
| T-011-5 | Publish member.removed event | 1h |
| T-011-6 | Write unit tests | 2h |

---

### US-TEN-012: Role-Based Access Control
**As a** tenant admin  
**I want to** have predefined roles with specific permissions  
**So that** team members have appropriate access levels

**Acceptance Criteria:**
- [ ] Owner: Full access, can delete tenant, transfer ownership
- [ ] Admin: Full access except tenant deletion and ownership transfer
- [ ] Editor: Create/edit campaigns, view analytics, cannot manage team
- [ ] Viewer: Read-only access to dashboard and analytics
- [ ] Permissions enforced across all endpoints

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-012-1 | Define role enum and permission matrix | 2h |
| T-012-2 | Create permissions decorator | 3h |
| T-012-3 | Implement RBAC guard | 4h |
| T-012-4 | Add permissions to JWT claims | 2h |
| T-012-5 | Apply guards to all endpoints | 4h |
| T-012-6 | Write comprehensive RBAC tests | 4h |

---

### US-TEN-013: Transfer Ownership
**As a** tenant owner  
**I want to** transfer ownership to another admin  
**So that** I can hand over control of the organization

**Acceptance Criteria:**
- [ ] Only owner can initiate transfer
- [ ] Target must be existing admin
- [ ] Require password confirmation
- [ ] Email confirmation to both parties
- [ ] Previous owner becomes admin after transfer
- [ ] Audit log entry

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-013-1 | Implement POST /tenants/:id/transfer-ownership | 3h |
| T-013-2 | Add password verification via Ory | 2h |
| T-013-3 | Create confirmation email flow | 2h |
| T-013-4 | Add audit logging | 1h |
| T-013-5 | Write unit tests | 2h |

---

# E-TEN-03: Settings & Configuration

> **Epic Description:** Tenant-level settings and customization options.

## User Stories

### US-TEN-014: General Settings
**As a** tenant admin  
**I want to** configure general settings  
**So that** the platform behaves according to my preferences

**Acceptance Criteria:**
- [ ] Set default currency (EUR, USD, GBP, CHF)
- [ ] Set timezone
- [ ] Set locale/language preference
- [ ] Configure date format
- [ ] Settings apply to new campaigns by default

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-014-1 | Create settings JSONB schema | 2h |
| T-014-2 | Implement GET /tenants/:id/settings endpoint | 2h |
| T-014-3 | Implement PUT /tenants/:id/settings endpoint | 2h |
| T-014-4 | Add settings validation | 2h |
| T-014-5 | Create settings defaults factory | 1h |
| T-014-6 | Write unit tests | 2h |

---

### US-TEN-015: Branding Settings
**As a** tenant admin  
**I want to** configure branding defaults  
**So that** new campaigns inherit my brand identity

**Acceptance Criteria:**
- [ ] Upload company logo
- [ ] Set primary brand color
- [ ] Set secondary brand color
- [ ] Configure font preference
- [ ] Preview branding changes
- [ ] Applied as defaults to new campaigns

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-015-1 | Add branding fields to settings JSONB | 1h |
| T-015-2 | Implement logo upload with S3 presigned URL | 3h |
| T-015-3 | Add color validation (hex format) | 1h |
| T-015-4 | Create branding preview endpoint | 2h |
| T-015-5 | Write unit tests | 2h |

---

### US-TEN-016: Notification Preferences
**As a** tenant admin  
**I want to** configure notification preferences  
**So that** I receive only relevant alerts

**Acceptance Criteria:**
- [ ] Toggle email notifications by type
- [ ] Configure Slack notifications (if connected)
- [ ] Set digest frequency (daily, weekly, never)
- [ ] Configure alert thresholds (notify if conversion drops >20%)
- [ ] Per-user override capability

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-016-1 | Create notification preferences schema | 2h |
| T-016-2 | Implement notification preferences endpoints | 3h |
| T-016-3 | Add per-user override logic | 2h |
| T-016-4 | Integrate with Integration Service | 2h |
| T-016-5 | Write unit tests | 2h |

---

### US-TEN-017: API Key Management
**As a** tenant admin  
**I want to** create and manage API keys  
**So that** I can integrate with my systems securely

**Acceptance Criteria:**
- [ ] Create new API key with name and permissions
- [ ] Display key only once at creation
- [ ] List active API keys (masked)
- [ ] Revoke API key instantly
- [ ] Set optional expiration date
- [ ] Track last used timestamp

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-017-1 | Create ApiKey entity with TypeORM | 2h |
| T-017-2 | Implement secure key generation (prefix + random) | 2h |
| T-017-3 | Implement POST /tenants/:id/api-keys endpoint | 3h |
| T-017-4 | Implement GET /tenants/:id/api-keys endpoint | 2h |
| T-017-5 | Implement DELETE /api-keys/:id endpoint | 2h |
| T-017-6 | Add API key authentication middleware | 3h |
| T-017-7 | Track last used timestamp on each request | 2h |
| T-017-8 | Write unit tests | 3h |

---

### US-TEN-018: Feature Flags
**As a** platform admin  
**I want to** enable/disable features per tenant  
**So that** I can control feature rollout and access

**Acceptance Criteria:**
- [ ] Toggle features on/off per tenant
- [ ] Features: AI builder, custom domain, API access, white-label
- [ ] Feature status reflected in UI
- [ ] Feature guards on relevant endpoints
- [ ] Cached in Redis for performance

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-018-1 | Create feature flags schema | 2h |
| T-018-2 | Implement feature flag service | 3h |
| T-018-3 | Create @RequireFeature decorator | 2h |
| T-018-4 | Implement feature flag guard | 2h |
| T-018-5 | Add Redis caching for flags | 2h |
| T-018-6 | Create admin endpoint to toggle flags | 2h |
| T-018-7 | Write unit tests | 2h |

---

# E-TEN-04: Billing & Subscription

> **Epic Description:** Subscription management, payment processing, and billing.

## User Stories

### US-TEN-019: View Current Plan
**As a** tenant admin  
**I want to** view my current plan details  
**So that** I understand my subscription and limits

**Acceptance Criteria:**
- [ ] Display current plan name and price
- [ ] Show billing cycle (monthly/annual)
- [ ] Display next billing date
- [ ] Show current usage vs limits
- [ ] Display payment method on file

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-019-1 | Implement GET /tenants/:id/subscription endpoint | 2h |
| T-019-2 | Integrate with Stripe to fetch subscription details | 3h |
| T-019-3 | Calculate usage metrics | 2h |
| T-019-4 | Create SubscriptionDTO | 2h |
| T-019-5 | Write unit tests | 2h |

---

### US-TEN-020: Subscribe to Plan
**As a** tenant admin  
**I want to** subscribe to a paid plan  
**So that** I can access premium features

**Acceptance Criteria:**
- [ ] Select plan from available options
- [ ] Choose monthly or annual billing
- [ ] Enter payment details via Stripe Elements
- [ ] Apply coupon/promo code if available
- [ ] Confirm subscription
- [ ] Access to plan features immediately

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-020-1 | Implement Stripe checkout session creation | 4h |
| T-020-2 | Create POST /tenants/:id/subscription/checkout endpoint | 3h |
| T-020-3 | Handle Stripe webhook for checkout.session.completed | 3h |
| T-020-4 | Update tenant billing_plan on successful payment | 2h |
| T-020-5 | Implement coupon validation | 2h |
| T-020-6 | Publish subscription.created event | 1h |
| T-020-7 | Write integration tests | 4h |

---

### US-TEN-021: Upgrade Plan
**As a** tenant admin  
**I want to** upgrade to a higher plan  
**So that** I can access more features and higher limits

**Acceptance Criteria:**
- [ ] View available upgrade options
- [ ] See prorated cost calculation
- [ ] Confirm upgrade
- [ ] Immediate access to new plan features
- [ ] Prorated charge on payment method
- [ ] Confirmation email sent

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-021-1 | Implement upgrade preview endpoint (proration) | 3h |
| T-021-2 | Create POST /tenants/:id/subscription/upgrade endpoint | 3h |
| T-021-3 | Integrate Stripe subscription update with proration | 4h |
| T-021-4 | Update tenant plan immediately | 2h |
| T-021-5 | Send upgrade confirmation email | 1h |
| T-021-6 | Publish subscription.upgraded event | 1h |
| T-021-7 | Write integration tests | 3h |

---

### US-TEN-022: Downgrade Plan
**As a** tenant admin  
**I want to** downgrade to a lower plan  
**So that** I can reduce costs

**Acceptance Criteria:**
- [ ] View available downgrade options
- [ ] Warning if current usage exceeds new plan limits
- [ ] Downgrade effective at end of billing cycle
- [ ] Display effective date
- [ ] Confirmation email sent
- [ ] Can cancel pending downgrade

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-022-1 | Implement usage vs plan limit validation | 3h |
| T-022-2 | Create POST /tenants/:id/subscription/downgrade endpoint | 3h |
| T-022-3 | Schedule Stripe subscription change for period end | 3h |
| T-022-4 | Store pending downgrade in database | 2h |
| T-022-5 | Implement cancel pending downgrade | 2h |
| T-022-6 | Send downgrade scheduled email | 1h |
| T-022-7 | Publish subscription.downgrade_scheduled event | 1h |
| T-022-8 | Write integration tests | 3h |

---

### US-TEN-023: Cancel Subscription
**As a** tenant admin  
**I want to** cancel my subscription  
**So that** I can stop being billed

**Acceptance Criteria:**
- [ ] Confirm cancellation with reason selection
- [ ] Subscription active until end of billing period
- [ ] Display end date
- [ ] Downgrade to free plan after expiry
- [ ] Offer pause option as alternative
- [ ] Confirmation email with reactivation link

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-023-1 | Create POST /tenants/:id/subscription/cancel endpoint | 3h |
| T-023-2 | Integrate Stripe cancel at period end | 2h |
| T-023-3 | Store cancellation reason | 1h |
| T-023-4 | Send cancellation confirmation email | 1h |
| T-023-5 | Implement reactivation endpoint | 2h |
| T-023-6 | Handle subscription expiry (Stripe webhook) | 3h |
| T-023-7 | Publish subscription.cancelled event | 1h |
| T-023-8 | Write integration tests | 3h |

---

### US-TEN-024: Update Payment Method
**As a** tenant admin  
**I want to** update my payment method  
**So that** my subscription continues without interruption

**Acceptance Criteria:**
- [ ] Add new card via Stripe Elements
- [ ] Set as default payment method
- [ ] Remove old payment methods
- [ ] Show payment method preview (last 4 digits, expiry)
- [ ] Retry failed payments with new method

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-024-1 | Create Stripe SetupIntent for adding card | 3h |
| T-024-2 | Implement POST /tenants/:id/payment-methods endpoint | 2h |
| T-024-3 | Implement GET /tenants/:id/payment-methods endpoint | 2h |
| T-024-4 | Implement DELETE /payment-methods/:id endpoint | 2h |
| T-024-5 | Handle payment method update in Stripe | 2h |
| T-024-6 | Write integration tests | 3h |

---

### US-TEN-025: View Billing History
**As a** tenant admin  
**I want to** view my billing history  
**So that** I can track expenses and download invoices

**Acceptance Criteria:**
- [ ] List all past invoices
- [ ] Show date, amount, status
- [ ] Download invoice as PDF
- [ ] Filter by date range
- [ ] Show upcoming invoice preview

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-025-1 | Implement GET /tenants/:id/invoices endpoint | 2h |
| T-025-2 | Integrate Stripe invoice listing | 2h |
| T-025-3 | Add invoice PDF download via Stripe | 2h |
| T-025-4 | Implement upcoming invoice preview | 2h |
| T-025-5 | Write unit tests | 2h |

---

### US-TEN-026: Handle Failed Payments
**As the** system  
**I want to** handle failed payments gracefully  
**So that** tenants can resolve issues before access is restricted

**Acceptance Criteria:**
- [ ] Detect failed payment via Stripe webhook
- [ ] Send notification email to billing admin
- [ ] Display banner in dashboard
- [ ] Retry payment automatically (Stripe Smart Retries)
- [ ] Grace period of 7 days before restriction
- [ ] Restrict access after grace period
- [ ] Restore access immediately on successful payment

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-026-1 | Handle invoice.payment_failed webhook | 3h |
| T-026-2 | Send failed payment notification | 2h |
| T-026-3 | Add payment_status field to tenant | 1h |
| T-026-4 | Implement grace period logic | 3h |
| T-026-5 | Create payment required guard | 2h |
| T-026-6 | Handle invoice.paid webhook for restoration | 2h |
| T-026-7 | Write integration tests | 3h |

---

# E-TEN-05: Plan Management

> **Epic Description:** Define and manage subscription plans and their limits.

## User Stories

### US-TEN-027: Define Plans
**As a** platform admin  
**I want to** define subscription plans  
**So that** tenants can choose appropriate pricing tiers

**Acceptance Criteria:**
- [ ] Create plan with name, description, price
- [ ] Set monthly and annual pricing
- [ ] Define feature limits per plan
- [ ] Set feature flags per plan
- [ ] Link to Stripe Price IDs
- [ ] Activate/deactivate plans

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-027-1 | Create Plan entity with TypeORM | 2h |
| T-027-2 | Create plan limits schema (JSONB) | 2h |
| T-027-3 | Implement CRUD endpoints for plans (admin only) | 4h |
| T-027-4 | Sync plans with Stripe Products/Prices | 4h |
| T-027-5 | Cache plans in Redis | 2h |
| T-027-6 | Write unit tests | 2h |

---

### US-TEN-028: Plan Limits Enforcement
**As the** system  
**I want to** enforce plan limits  
**So that** tenants cannot exceed their allocation

**Acceptance Criteria:**
- [ ] Track usage: campaigns, referrers, API calls, team members
- [ ] Soft limit warning at 80% usage
- [ ] Hard limit prevents creation at 100%
- [ ] Usage resets monthly for API calls
- [ ] Display usage in dashboard
- [ ] Suggest upgrade when hitting limits

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-028-1 | Create UsageTracker service | 4h |
| T-028-2 | Implement usage check middleware | 3h |
| T-028-3 | Add usage increment on resource creation | 2h |
| T-028-4 | Implement monthly usage reset (Bull job) | 2h |
| T-028-5 | Create limit exceeded exception | 1h |
| T-028-6 | Implement GET /tenants/:id/usage endpoint | 2h |
| T-028-7 | Write unit tests | 3h |

---

### US-TEN-029: List Available Plans
**As a** tenant admin  
**I want to** see all available plans  
**So that** I can compare and choose the right one

**Acceptance Criteria:**
- [ ] Display all active plans
- [ ] Show monthly and annual pricing
- [ ] Highlight current plan
- [ ] Show feature comparison
- [ ] Show savings for annual billing
- [ ] Mark recommended plan

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-029-1 | Implement GET /plans endpoint (public) | 2h |
| T-029-2 | Create plan comparison DTO | 2h |
| T-029-3 | Calculate annual savings | 1h |
| T-029-4 | Add recommendation logic | 2h |
| T-029-5 | Write unit tests | 2h |

---

### US-TEN-030: Custom Enterprise Plans
**As a** platform admin  
**I want to** create custom plans for enterprise clients  
**So that** I can offer tailored pricing

**Acceptance Criteria:**
- [ ] Create custom plan for specific tenant
- [ ] Set custom limits and pricing
- [ ] Custom plan only visible to assigned tenant
- [ ] Custom contract terms field
- [ ] Manual invoice option

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-030-1 | Add tenant_id field to Plan (null = public) | 1h |
| T-030-2 | Create enterprise plan CRUD (admin only) | 3h |
| T-030-3 | Filter plans by tenant visibility | 2h |
| T-030-4 | Add manual invoicing flag | 1h |
| T-030-5 | Write unit tests | 2h |

---

### US-TEN-031: Free Trial
**As a** new tenant  
**I want to** start with a free trial  
**So that** I can evaluate the platform before paying

**Acceptance Criteria:**
- [ ] 14-day free trial of Growth plan features
- [ ] No credit card required to start
- [ ] Trial countdown displayed in dashboard
- [ ] Email reminders at 7 days, 3 days, 1 day, expired
- [ ] Downgrade to Free plan after trial expires
- [ ] Option to upgrade anytime during trial

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-031-1 | Add trial_ends_at field to Tenant | 1h |
| T-031-2 | Set trial on tenant creation | 1h |
| T-031-3 | Create trial expiry check middleware | 2h |
| T-031-4 | Schedule trial reminder emails (Bull job) | 3h |
| T-031-5 | Handle trial expiry (downgrade to free) | 2h |
| T-031-6 | Implement early upgrade during trial | 2h |
| T-031-7 | Write unit tests | 2h |

---

# E-TEN-06: Account Lifecycle

> **Epic Description:** Handle account suspension, locking, data export, and deletion.

## User Stories

### US-TEN-032: Suspend Tenant
**As a** platform admin  
**I want to** suspend a tenant account  
**So that** I can handle policy violations or non-payment

**Acceptance Criteria:**
- [ ] Suspend tenant with reason
- [ ] Suspended tenant cannot access dashboard
- [ ] Suspended tenant's campaigns paused
- [ ] Tracking continues (don't break customer's site)
- [ ] Email notification sent
- [ ] Admin can unsuspend

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-032-1 | Add status field to Tenant (active, suspended, locked) | 1h |
| T-032-2 | Create POST /admin/tenants/:id/suspend endpoint | 2h |
| T-032-3 | Create tenant status guard | 2h |
| T-032-4 | Publish tenant.suspended event | 1h |
| T-032-5 | Handle campaign pausing in Campaign Service | 2h |
| T-032-6 | Send suspension notification | 1h |
| T-032-7 | Implement unsuspend endpoint | 2h |
| T-032-8 | Write unit tests | 2h |

---

### US-TEN-033: Company Information Onboarding
**As a** new tenant owner  
**I want to** complete my company information  
**So that** I can receive proper invoices and comply with regulations

**Acceptance Criteria:**
- [ ] Onboarding wizard prompts after first login
- [ ] Collect: company legal name, country, address
- [ ] Collect: VAT number (required for EU), billing email
- [ ] Validate required fields based on country
- [ ] Save company info to tenant record
- [ ] Block campaign creation until completed (soft block with reminder)
- [ ] Block plan upgrade until completed (hard block)
- [ ] Onboarding status trackable (incomplete, complete)

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-033-1 | Add company JSONB fields to Tenant entity | 2h |
| T-033-2 | Create PUT /tenants/:id/company endpoint | 2h |
| T-033-3 | Add country-specific validation rules | 3h |
| T-033-4 | Implement onboarding status logic | 2h |
| T-033-5 | Create onboarding guard middleware | 2h |
| T-033-6 | Add onboarding.completed event | 1h |
| T-033-7 | Write unit tests | 2h |
| T-033-8 | Write integration tests | 2h |

---

### US-TEN-033B: VAT Number Validation 🆕
**As a** tenant owner  
**I want to** have my VAT number automatically verified  
**So that** I can receive invoices with reverse charge (no VAT)

**Acceptance Criteria:**
- [ ] VAT number validated via VIES API (EU)
- [ ] Company name from VIES compared with provided name
- [ ] Valid VAT → verification status "verified"
- [ ] Invalid VAT → show error, allow correction
- [ ] VAT results cached for 30 days
- [ ] Swiss companies → manual verification flag
- [ ] Verified VAT passed to Stripe for tax calculation

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-033B-1 | Create VatValidationCache entity | 1h |
| T-033B-2 | Implement VIES API integration | 4h |
| T-033B-3 | Create POST /tenants/:id/verify-vat endpoint | 2h |
| T-033B-4 | Add verification JSONB to Tenant | 1h |
| T-033B-5 | Implement caching logic (30 days) | 2h |
| T-033B-6 | Handle VIES downtime gracefully | 2h |
| T-033B-7 | Sync valid VAT to Stripe customer.tax_ids | 2h |
| T-033B-8 | Write unit tests | 2h |
| T-033B-9 | Write integration tests | 3h |

---

### US-TEN-033C: Manual Company Verification 🆕
**As an** admin  
**I want to** manually verify companies that can't be auto-verified  
**So that** Swiss and non-EU companies can also use the platform

**Acceptance Criteria:**
- [ ] Admin queue shows pending verifications
- [ ] Display company info, documents (if uploaded)
- [ ] Admin can approve with notes
- [ ] Admin can reject with reason
- [ ] Tenant notified of verification result
- [ ] Audit log entry for verification decisions

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-033C-1 | Create admin verification queue endpoint | 2h |
| T-033C-2 | Implement POST /admin/tenants/:id/verify | 2h |
| T-033C-3 | Implement POST /admin/tenants/:id/reject-verification | 2h |
| T-033C-4 | Add verification notification emails | 2h |
| T-033C-5 | Create audit log entries | 1h |
| T-033C-6 | Write unit tests | 2h |

---

### US-TEN-034: Export Tenant Data
**As a** tenant owner  
**I want to** export all my data  
**So that** I have a backup and comply with GDPR

**Acceptance Criteria:**
- [ ] Request data export
- [ ] Export includes: campaigns, referrers, referrals, rewards, payouts
- [ ] Export generated as ZIP with JSON files
- [ ] Download link sent via email
- [ ] Link expires after 7 days
- [ ] Limit: 1 export per 24 hours

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-034-1 | Create POST /tenants/:id/export endpoint | 2h |
| T-034-2 | Implement data export Bull job | 4h |
| T-034-3 | Call other services for their data | 4h |
| T-034-4 | Generate ZIP file and upload to S3 | 3h |
| T-034-5 | Create presigned download URL | 2h |
| T-034-6 | Send export ready email | 1h |
| T-034-7 | Implement rate limiting (1 per 24h) | 1h |
| T-034-8 | Write integration tests | 3h |

---

### US-TEN-035: Delete Tenant
**As a** tenant owner  
**I want to** permanently delete my account  
**So that** my data is removed from the platform

**Acceptance Criteria:**
- [ ] Require password confirmation
- [ ] 30-day grace period before permanent deletion
- [ ] Email confirmation with cancellation link
- [ ] Scheduled deletion can be cancelled
- [ ] All data deleted after grace period
- [ ] Subscription cancelled immediately

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-035-1 | Implement POST /tenants/:id/delete endpoint | 3h |
| T-035-2 | Add deletion_scheduled_at field | 1h |
| T-035-3 | Require password confirmation | 2h |
| T-035-4 | Send deletion scheduled email | 1h |
| T-035-5 | Implement cancel deletion endpoint | 2h |
| T-035-6 | Create deletion Bull job (runs after 30 days) | 4h |
| T-035-7 | Publish tenant.deletion_scheduled event | 1h |
| T-035-8 | Coordinate data deletion across services | 4h |
| T-035-9 | Write integration tests | 3h |

---

### US-TEN-036: Unsubscribe from Emails
**As a** user  
**I want to** unsubscribe from marketing emails  
**So that** I don't receive unwanted communications

**Acceptance Criteria:**
- [ ] One-click unsubscribe link in all emails
- [ ] Unsubscribe page confirms action
- [ ] Option to unsubscribe from specific types
- [ ] Transactional emails not affected
- [ ] Resubscribe option available
- [ ] GDPR compliant

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-036-1 | Generate unique unsubscribe token per user | 2h |
| T-036-2 | Create GET /unsubscribe/:token endpoint | 2h |
| T-036-3 | Create unsubscribe confirmation page | 2h |
| T-036-4 | Store email preferences per user | 2h |
| T-036-5 | Implement POST /unsubscribe with options | 2h |
| T-036-6 | Add List-Unsubscribe header to emails | 1h |
| T-036-7 | Write unit tests | 2h |

---

### US-TEN-037: Audit Log
**As a** tenant admin  
**I want to** view audit logs  
**So that** I can track important changes to my account

**Acceptance Criteria:**
- [ ] Log all sensitive actions (settings, team, billing)
- [ ] Show who, what, when, IP address
- [ ] Filter by action type, user, date range
- [ ] Hot storage: PostgreSQL (last 90 days)
- [ ] Cold storage: Archive to S3 (Parquet format)
- [ ] Query archived logs via Athena if needed
- [ ] Export audit log as CSV

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-037-1 | Create AuditLog entity with table partitioning | 3h |
| T-037-2 | Create audit log interceptor | 3h |
| T-037-3 | Define auditable actions enum | 1h |
| T-037-4 | Implement GET /tenants/:id/audit-log endpoint | 2h |
| T-037-5 | Add filtering and pagination | 2h |
| T-037-6 | Implement CSV export | 2h |
| T-037-7 | Create S3 archive job (monthly, Parquet format) | 4h |
| T-037-8 | Delete archived partitions from PostgreSQL | 2h |
| T-037-9 | Write unit tests | 2h |

---

# E-TEN-07: Payment Enforcement

> **Epic Description:** Handle payment failures, grace periods, account restrictions, and restoration.

## User Stories

### US-TEN-038: Payment Failure Detection
**As the** system  
**I want to** detect failed payments via Stripe webhooks  
**So that** I can initiate the grace period flow

**Acceptance Criteria:**
- [ ] Handle invoice.payment_failed webhook
- [ ] Update tenant payment_status to 'past_due'
- [ ] Record payment_failed_at timestamp
- [ ] Send immediate notification to billing admin
- [ ] Display warning banner in dashboard
- [ ] Stripe Smart Retries continue automatically

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-038-1 | Add payment_status field to Tenant entity | 1h |
| T-038-2 | Create Stripe webhook handler for payment_failed | 3h |
| T-038-3 | Send payment failed notification email | 2h |
| T-038-4 | Add dashboard banner component for payment warning | 2h |
| T-038-5 | Write integration tests | 2h |

---

### US-TEN-039: Account Restriction (Day 7)
**As the** system  
**I want to** restrict account access after 7 days of non-payment  
**So that** unpaid accounts have limited functionality

**Acceptance Criteria:**
- [ ] Daily job checks past_due accounts older than 7 days
- [ ] Update status to 'restricted'
- [ ] Read-only access to dashboard (view analytics, reports)
- [ ] Cannot create/edit campaigns, invite members, change settings
- [ ] CAN update payment method
- [ ] Campaigns continue running (don't break customer's site)
- [ ] Send restriction notification email

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-039-1 | Create daily payment status check job | 3h |
| T-039-2 | Implement PaymentStatusGuard for read-only enforcement | 3h |
| T-039-3 | Allow billing endpoints in restricted mode | 2h |
| T-039-4 | Send restriction notification email | 1h |
| T-039-5 | Write unit tests | 2h |

---

### US-TEN-040: Account Locking (Day 21)
**As the** system  
**I want to** lock accounts after 21 days of non-payment  
**So that** long-unpaid accounts are fully restricted

**Acceptance Criteria:**
- [ ] Daily job checks restricted accounts older than 14 days
- [ ] Update status to 'locked'
- [ ] No dashboard access (redirect to payment page)
- [ ] Pause all campaigns
- [ ] Invalidate CDN cache for widgets/landing pages
- [ ] Tracker returns 402 (widgets hide/show fallback)
- [ ] Landing pages show "program paused" message
- [ ] Send lock notification email

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-040-1 | Extend daily job for locked transition | 2h |
| T-040-2 | Create locked account redirect middleware | 2h |
| T-040-3 | Publish tenant.locked event for Campaign Service | 2h |
| T-040-4 | Implement CDN cache invalidation | 3h |
| T-040-5 | Update Tracker to check tenant status | 2h |
| T-040-6 | Send lock notification email | 1h |
| T-040-7 | Write integration tests | 3h |

---

### US-TEN-041: Payment Restoration
**As the** system  
**I want to** immediately restore access when payment succeeds  
**So that** paying customers regain full functionality

**Acceptance Criteria:**
- [ ] Handle invoice.paid Stripe webhook
- [ ] Update status to 'active' immediately
- [ ] Clear all payment_failed timestamps
- [ ] Campaigns remain paused (manual reactivation)
- [ ] Send restoration confirmation email
- [ ] Dashboard access restored

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-041-1 | Create Stripe webhook handler for invoice.paid | 2h |
| T-041-2 | Reset all payment status fields | 1h |
| T-041-3 | Publish tenant.restored event | 1h |
| T-041-4 | Send restoration confirmation email | 1h |
| T-041-5 | Write integration tests | 2h |

---

### US-TEN-042: Payment Reminder Emails
**As the** system  
**I want to** send scheduled payment reminder emails  
**So that** customers are informed before restrictions

**Acceptance Criteria:**
- [ ] Day 0: Payment failed email
- [ ] Day 3: First reminder
- [ ] Day 5: Second reminder (2 days until restriction)
- [ ] Day 7: Restricted notification
- [ ] Day 14: Final warning (7 days until lock)
- [ ] Day 21: Account locked notification
- [ ] Weekly reminders after lock

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-042-1 | Create email templates for each reminder stage | 3h |
| T-042-2 | Implement reminder scheduling logic in daily job | 3h |
| T-042-3 | Track reminder count to avoid duplicates | 1h |
| T-042-4 | Write unit tests | 2h |

---

# E-TEN-08: GDPR Compliance

> **Epic Description:** Features required for GDPR compliance including data export, deletion, and consent management.

## User Stories

### US-TEN-043: Data Export (Right to Access)
**As a** tenant owner  
**I want to** export all my organization's data  
**So that** I comply with GDPR data access requests

**Acceptance Criteria:**
- [ ] Request data export from settings
- [ ] Rate limited: 1 export per 24 hours
- [ ] Export queued and processed asynchronously
- [ ] Collect data from all services (campaigns, referrers, rewards, etc.)
- [ ] Package as ZIP with JSON files
- [ ] Upload to S3 with presigned URL (7 days expiry)
- [ ] Email notification when ready

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-043-1 | Create export request endpoint with rate limiting | 2h |
| T-043-2 | Create Bull job for async export processing | 3h |
| T-043-3 | Implement data collection from each service | 6h |
| T-043-4 | Create ZIP packaging and S3 upload | 3h |
| T-043-5 | Send export ready email with download link | 2h |
| T-043-6 | Write integration tests | 3h |

---

### US-TEN-044: Member Removal with Data Handling
**As a** tenant admin  
**I want to** remove team members properly  
**So that** their access is revoked and data is handled per GDPR

**Acceptance Criteria:**
- [ ] Revoke all sessions immediately
- [ ] Soft delete member record (keep for audit)
- [ ] Send notification to removed member
- [ ] Schedule PII anonymization after 30 days
- [ ] Preserve audit log entries with snapshot
- [ ] Cannot remove self or last admin

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-044-1 | Implement session revocation for specific tenant | 3h |
| T-044-2 | Add soft delete with removed_at, removed_by fields | 2h |
| T-044-3 | Create member removal notification email | 1h |
| T-044-4 | Schedule anonymization job (30 days) | 2h |
| T-044-5 | Add validation (cannot remove self/last admin) | 2h |
| T-044-6 | Write unit tests | 2h |

---

### US-TEN-045: Account Deletion (Right to Erasure)
**As a** tenant owner  
**I want to** delete my organization permanently  
**So that** all data is removed per GDPR

**Acceptance Criteria:**
- [ ] Require password confirmation
- [ ] 30-day grace period with cancellation option
- [ ] Immediate: Cancel Stripe, pause campaigns, notify team
- [ ] During grace: Read-only access, reminder emails (Day 7, 21, 29)
- [ ] After 30 days: Delete data from ALL services
- [ ] Archive audit logs to S3 before deletion
- [ ] Send final confirmation email

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-045-1 | Create deletion request endpoint with password verification | 3h |
| T-045-2 | Add deletion_scheduled_at field and status | 1h |
| T-045-3 | Cancel Stripe subscription on request | 2h |
| T-045-4 | Create cancel deletion endpoint | 2h |
| T-045-5 | Schedule deletion job (30 days) | 2h |
| T-045-6 | Implement cross-service deletion coordinator | 6h |
| T-045-7 | Archive audit logs before deletion | 2h |
| T-045-8 | Send notification emails (scheduled, cancelled, completed) | 2h |
| T-045-9 | Write integration tests | 4h |

---

### US-TEN-046: Data Retention Automation
**As the** system  
**I want to** automatically delete old data per retention policy  
**So that** we comply with GDPR storage limitation

**Acceptance Criteria:**
- [ ] Daily job runs at 3 AM
- [ ] Delete click events older than 2 years
- [ ] Archive audit logs older than 90 days to S3
- [ ] Delete tracker sessions older than 90 days
- [ ] Anonymize removed members after 30 days
- [ ] Delete abandoned AI conversations after 30 days
- [ ] Log all deletions

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-046-1 | Create daily retention cleanup job | 2h |
| T-046-2 | Implement click event deletion (partitioned) | 2h |
| T-046-3 | Implement audit log archival to S3 Parquet | 3h |
| T-046-4 | Implement tracker session cleanup | 1h |
| T-046-5 | Implement member anonymization | 2h |
| T-046-6 | Log retention actions for compliance | 1h |
| T-046-7 | Write unit tests | 2h |

---

### US-TEN-047: Legal Documents Management
**As a** tenant admin  
**I want to** access legal documents (Privacy Policy, DPA, Terms)  
**So that** I can review compliance documents

**Acceptance Criteria:**
- [ ] Privacy Policy link in footer and settings
- [ ] Terms of Service link
- [ ] DPA download (PDF)
- [ ] Cookie Policy link
- [ ] Sub-processor list (viewable and downloadable)
- [ ] Version history for legal documents

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-047-1 | Create legal documents page in dashboard | 2h |
| T-047-2 | Upload legal documents to S3 (PDF) | 1h |
| T-047-3 | Create DPA download endpoint | 1h |
| T-047-4 | Create sub-processor list page | 2h |
| T-047-5 | Write unit tests | 1h |

---

### US-TEN-048: Referrer GDPR Deletion
**As a** referrer  
**I want to** request deletion of my personal data  
**So that** my right to erasure is respected

**Acceptance Criteria:**
- [ ] Referrer can request deletion from portal
- [ ] Verify identity (email confirmation)
- [ ] Check for pending payouts (block if pending)
- [ ] Anonymize personal data (keep records for tax, 7 years)
- [ ] Email: deleted-{id}@anonymized.local
- [ ] Name: "Deleted User"
- [ ] Payout details: removed
- [ ] Send confirmation email

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-048-1 | Create referrer deletion request endpoint | 2h |
| T-048-2 | Implement email verification flow | 2h |
| T-048-3 | Check pending payouts before deletion | 2h |
| T-048-4 | Implement anonymization (preserve tax records) | 2h |
| T-048-5 | Send deletion confirmation email | 1h |
| T-048-6 | Write unit tests | 2h |

---

# E-TEN-09: Company Onboarding & Verification 🆕

> **Epic Description:** Company information collection, VAT validation, and verification processes required for B2B compliance and proper invoicing.

## User Stories

### US-TEN-049: Company Information Collection
**As a** new tenant owner  
**I want to** provide my company details during onboarding  
**So that** I receive proper invoices and can use the platform for business

**Acceptance Criteria:**
- [ ] Onboarding wizard prompts after first login
- [ ] Collect: company legal name, trading name (if different)
- [ ] Collect: country, billing address (street, city, postal code)
- [ ] Collect: company size, industry, website URL
- [ ] Collect: billing email and phone
- [ ] Country determines which fields are required
- [ ] Progress saved automatically (can resume later)
- [ ] Onboarding status: not_started → in_progress → completed

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-049-1 | Add company and billing_address JSONB to Tenant | 2h |
| T-049-2 | Create PUT /tenants/:id/company endpoint | 2h |
| T-049-3 | Create PUT /tenants/:id/billing-address endpoint | 2h |
| T-049-4 | Add country-specific validation rules | 3h |
| T-049-5 | Implement onboarding status tracking | 2h |
| T-049-6 | Create GET /tenants/:id/onboarding status endpoint | 1h |
| T-049-7 | Write unit tests | 2h |
| T-049-8 | Write integration tests | 2h |

---

### US-TEN-050: VAT Number Validation
**As a** tenant owner in the EU  
**I want to** have my VAT number automatically verified  
**So that** I can benefit from reverse charge (no VAT on invoices)

**Acceptance Criteria:**
- [ ] VAT number validated via VIES API (European Commission)
- [ ] Company name from VIES response displayed for confirmation
- [ ] Valid VAT → verification.vat_verified = true
- [ ] Invalid VAT → clear error message with format example
- [ ] VAT validation results cached for 30 days
- [ ] Retry allowed after failed validation
- [ ] Valid VAT automatically synced to Stripe (customer.tax_ids)

**VIES API Response Example:**
```json
{
  "countryCode": "DE",
  "vatNumber": "123456789",
  "valid": true,
  "name": "ACME GmbH",
  "address": "Musterstraße 1, 10115 Berlin"
}
```

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-050-1 | Create VatValidationCache entity | 1h |
| T-050-2 | Implement VIES REST API client | 3h |
| T-050-3 | Handle VIES downtime/timeout gracefully | 2h |
| T-050-4 | Create POST /tenants/:id/verify-vat endpoint | 2h |
| T-050-5 | Add verification JSONB to Tenant entity | 1h |
| T-050-6 | Implement 30-day caching logic | 2h |
| T-050-7 | Sync valid VAT to Stripe customer.tax_ids | 2h |
| T-050-8 | Write unit tests | 2h |
| T-050-9 | Write integration tests (mock VIES) | 3h |

---

### US-TEN-051: Verification Status Management
**As a** tenant owner  
**I want to** see my verification status  
**So that** I know if I need to take action

**Acceptance Criteria:**
- [ ] Display verification status: pending, verified, failed, manual_review
- [ ] Show which checks passed/failed (VAT, company, domain)
- [ ] Explain benefits of verification (reverse charge, trust badge)
- [ ] Allow re-verification if previously failed
- [ ] Non-EU/Swiss companies → automatic manual_review status
- [ ] Clear call-to-action for incomplete verification

**Verification Status Matrix:**

| Country | VAT Required | Verification Method |
|---------|--------------|---------------------|
| Germany (DE) | Yes | VIES API |
| Austria (AT) | Yes | VIES API |
| EU (other) | Yes | VIES API |
| Switzerland (CH) | Optional | Manual review |
| Non-EU | No | Manual review |

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-051-1 | Create GET /tenants/:id/verification endpoint | 2h |
| T-051-2 | Build verification status response DTO | 2h |
| T-051-3 | Implement re-verification logic | 2h |
| T-051-4 | Create verification status change events | 1h |
| T-051-5 | Write unit tests | 2h |

---

### US-TEN-052: Manual Company Verification (Admin)
**As an** admin  
**I want to** manually verify companies that can't be auto-verified  
**So that** Swiss and non-EU companies can fully use the platform

**Acceptance Criteria:**
- [ ] Admin dashboard shows pending verification queue
- [ ] Display: company name, country, VAT (if provided), website
- [ ] Admin can search company in local registries (links provided)
- [ ] Admin can approve with verification notes
- [ ] Admin can reject with specific reason
- [ ] Tenant owner notified of verification result via email
- [ ] Audit log entry created for all verification decisions

**Registry Links by Country:**
- Germany: Handelsregister (handelsregister.de)
- Austria: Firmenbuch (firmenbuch.at)
- Switzerland: Zefix (zefix.ch)
- France: Infogreffe (infogreffe.fr)

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-052-1 | Create admin verification queue endpoint | 3h |
| T-052-2 | Implement POST /admin/tenants/:id/verify endpoint | 2h |
| T-052-3 | Implement POST /admin/tenants/:id/reject-verification | 2h |
| T-052-4 | Create verification approval email template | 1h |
| T-052-5 | Create verification rejection email template | 1h |
| T-052-6 | Add audit log entries for verification decisions | 2h |
| T-052-7 | Build registry lookup helper (external links) | 2h |
| T-052-8 | Write unit tests | 2h |
| T-052-9 | Write integration tests | 2h |

---

### US-TEN-053: Onboarding Enforcement
**As the** system  
**I want to** enforce onboarding completion  
**So that** tenants provide required information before using paid features

**Acceptance Criteria:**
- [ ] Soft block: Reminder shown when creating first campaign
- [ ] Hard block: Cannot upgrade to paid plan without completed onboarding
- [ ] Hard block: Cannot create payout methods without verified company
- [ ] Grace period: 7 days from signup to complete onboarding
- [ ] Reminder emails: Day 3, Day 5, Day 7
- [ ] After Day 7: Persistent banner in dashboard

**Tasks:**
| Task ID | Task | Estimate |
|---------|------|----------|
| T-053-1 | Create onboarding guard middleware | 3h |
| T-053-2 | Implement soft block logic (reminder, allow continue) | 2h |
| T-053-3 | Implement hard block logic (upgrade, payouts) | 2h |
| T-053-4 | Create onboarding reminder email templates | 2h |
| T-053-5 | Schedule reminder emails (Bull job) | 2h |
| T-053-6 | Add onboarding banner event for frontend | 1h |
| T-053-7 | Write unit tests | 2h |

---

# Backlog Summary

## Story Points Overview

| Epic | Stories | Total Estimate |
|------|---------|----------------|
| E-TEN-01: Tenant Management | 4 | ~55h |
| E-TEN-02: Team & Access | 7 | ~95h |
| E-TEN-03: Settings | 5 | ~60h |
| E-TEN-04: Billing | 8 | ~110h |
| E-TEN-05: Plan Management | 5 | ~65h |
| E-TEN-06: Account Lifecycle | 5 | ~75h |
| E-TEN-07: Payment Enforcement | 5 | ~55h |
| E-TEN-08: GDPR Compliance | 6 | ~75h |
| E-TEN-09: Company Onboarding 🆕 | 5 | ~80h |
| **TOTAL** | **50** | **~670h** |
| E-TEN-07: Payment Enforcement | 5 | ~55h |
| E-TEN-08: GDPR Compliance | 6 | ~75h |
| **TOTAL** | **46** | **~605h** |

## Deferred to V1.1

| Feature | Reason |
|---------|--------|
| Custom Domain Setup | Using wildcard subdomain `*.referralapp.io` for MVP |
| Subdomain Management | Not needed - slug is just a DB field |
| Domain Verification | Optional trust signal, not required for MVP |

## MVP Scope (Recommended)

### Must Have (P0)
- US-TEN-001: Tenant Registration
- US-TEN-002: View Tenant Profile
- US-TEN-003: Update Tenant Profile
- US-TEN-007: Invite Team Member
- US-TEN-008: Accept Team Invitation
- US-TEN-009: List Team Members
- US-TEN-012: Role-Based Access Control
- US-TEN-014: General Settings
- US-TEN-017: API Key Management
- US-TEN-019: View Current Plan
- US-TEN-020: Subscribe to Plan
- US-TEN-023: Cancel Subscription
- US-TEN-027: Define Plans
- US-TEN-028: Plan Limits Enforcement
- US-TEN-031: Free Trial
- US-TEN-038: Payment Failure Detection
- US-TEN-039: Account Restriction
- US-TEN-040: Account Locking
- US-TEN-041: Payment Restoration
- US-TEN-043: Data Export (GDPR)
- US-TEN-045: Account Deletion (GDPR)
- US-TEN-047: Legal Documents
- **US-TEN-049: Company Information Collection** 🆕
- **US-TEN-050: VAT Number Validation** 🆕
- **US-TEN-051: Verification Status Management** 🆕
- **US-TEN-053: Onboarding Enforcement** 🆕

### Should Have (P1)
- US-TEN-004: Tenant Dashboard Stats
- US-TEN-010: Update Team Member Role
- US-TEN-011: Remove Team Member
- US-TEN-015: Branding Settings
- US-TEN-021: Upgrade Plan
- US-TEN-022: Downgrade Plan
- US-TEN-024: Update Payment Method
- US-TEN-025: View Billing History
- US-TEN-026: Handle Failed Payments
- US-TEN-032: Suspend Tenant
- US-TEN-034: Export Tenant Data
- US-TEN-035: Delete Tenant
- US-TEN-036: Unsubscribe from Emails
- US-TEN-037: Audit Log
- US-TEN-042: Payment Reminder Emails
- US-TEN-044: Member Removal with Data Handling
- US-TEN-046: Data Retention Automation
- US-TEN-048: Referrer GDPR Deletion
- **US-TEN-052: Manual Company Verification** 🆕

### Nice to Have (P2)
- US-TEN-013: Transfer Ownership
- US-TEN-016: Notification Preferences
- US-TEN-018: Feature Flags
- US-TEN-029: List Available Plans
- US-TEN-030: Custom Enterprise Plans

---

## Sprint Recommendations

### Sprint 1 (2 weeks) - Foundation
- US-TEN-001: Tenant Registration
- US-TEN-002: View Tenant Profile
- US-TEN-003: Update Tenant Profile
- US-TEN-012: Role-Based Access Control
- US-TEN-014: General Settings

### Sprint 2 (2 weeks) - Company Onboarding 🆕
- US-TEN-049: Company Information Collection
- US-TEN-050: VAT Number Validation
- US-TEN-051: Verification Status Management
- US-TEN-053: Onboarding Enforcement

### Sprint 3 (2 weeks) - Team Management
- US-TEN-007: Invite Team Member
- US-TEN-008: Accept Team Invitation
- US-TEN-009: List Team Members
- US-TEN-010: Update Team Member Role
- US-TEN-011: Remove Team Member

### Sprint 4 (2 weeks) - Billing Foundation
- US-TEN-027: Define Plans
- US-TEN-019: View Current Plan
- US-TEN-020: Subscribe to Plan
- US-TEN-031: Free Trial

### Sprint 5 (2 weeks) - Billing Complete
- US-TEN-021: Upgrade Plan
- US-TEN-022: Downgrade Plan
- US-TEN-023: Cancel Subscription
- US-TEN-028: Plan Limits Enforcement

### Sprint 6 (2 weeks) - Payment Enforcement
- US-TEN-038: Payment Failure Detection
- US-TEN-039: Account Restriction
- US-TEN-040: Account Locking
- US-TEN-041: Payment Restoration
- US-TEN-042: Payment Reminder Emails

### Sprint 7 (2 weeks) - GDPR & Compliance
- US-TEN-043: Data Export
- US-TEN-045: Account Deletion
- US-TEN-046: Data Retention Automation
- US-TEN-047: Legal Documents

### Sprint 8 (2 weeks) - Settings & API
- US-TEN-015: Branding Settings
- US-TEN-017: API Key Management
- US-TEN-024: Update Payment Method
- US-TEN-025: View Billing History

### Sprint 9 (2 weeks) - Account Lifecycle & Admin
- US-TEN-026: Handle Failed Payments
- US-TEN-032: Suspend Tenant
- US-TEN-037: Audit Log
- US-TEN-044: Member Removal with Data Handling
- US-TEN-048: Referrer GDPR Deletion
- US-TEN-052: Manual Company Verification

---

**Document Version:** 1.1  
**Updated:** December 2024  
**Service:** Tenant Service  
**Changes:** Added Company Onboarding & Verification epic (E-TEN-09), removed self-lock feature
