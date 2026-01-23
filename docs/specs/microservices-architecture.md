# Microservices Architecture v3
## Referral Marketing SaaS Platform

**Version:** 3.0  
**Date:** December 2024

---

## Updates from v2.1

| Change | Description |
|--------|-------------|
| **Payment Enforcement** | Added payment_status, grace period, locking flows |
| **AI Fraud Agent** | New agent for fraud detection and risk scoring |
| **AI Reward Agent** | New agent for auto-approval and payout intelligence |
| **AI Analytics Agent** | New agent for natural language queries |
| **SDK/Tracker Behavior** | Documented behavior by account state |
| **Account Lifecycle** | Member removal, account deletion flows |
| **GDPR Compliance** | Data export, deletion, retention automation |
| **Wildcard Subdomain** | MVP uses `*.referralapp.io` |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE (CDN/WAF/DNS)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS ALB (Public)                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
            ┌───────────────────────────────────────────────────┐
            │                 TRAEFIK (API Gateway)              │
            │  • JWT validation (Ory)  • Tenant extraction       │
            │  • Rate limiting         • Request routing         │
            └───────────────────────────────────────────────────┘
                                        │
        ┌───────────┬───────────┬───────┴───────┬───────────┬───────────┐
        ▼           ▼           ▼               ▼           ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Tenant  │ │Campaign │ │ Tracker │   │Referral │ │ Reward  │ │Analytics│
   │ Service │ │ Service │ │ Service │   │ Service │ │ Service │ │ Service │
   └─────────┘ └─────────┘ └─────────┘   └─────────┘ └─────────┘ └─────────┘
        │           │           │               │           │           │
        │           └───────────┴───────┬───────┴───────────┘           │
        │                               │                               │
        │                        ┌──────┴──────┐                        │
        │                        │     AI      │                        │
        │                        │   Service   │◄───────────────────────┘
        │                        └──────┬──────┘
        │                               │
        └───────────┬───────────────────┼───────────────────────────────┐
                    │                   │                               │
                    │          ┌────────┴────────┐                      │
                    │          │  Integration    │                      │
                    │          │    Service      │                      │
                    │          └────────┬────────┘                      │
                    │                   │                               │
        ┌───────────┴───────┬───────────┼───────────┬───────────────────┘
        ▼                   ▼           ▼           ▼                    
   ┌─────────┐        ┌──────────┐ ┌──────────┐ ┌──────────┐    ┌─────────┐
   │   Ory   │        │   RDS    │ │ClickHouse│ │  Redis   │    │ SQS/SNS │
   │  Stack  │        │(Postgres)│ │          │ │(Elastic) │    │         │
   └─────────┘        └──────────┘ └──────────┘ └──────────┘    └─────────┘
```

---

## 8 Services

| # | Service | Domain | Database |
|---|---------|--------|----------|
| 1 | **Tenant Service** | Accounts, Teams, Billing | PostgreSQL |
| 2 | **Campaign Service** | Campaigns, Widgets, Landing Pages | PostgreSQL |
| 3 | **Tracker Service** | Public Event Tracking, SDK Backend | PostgreSQL (partitioned) |
| 4 | **Referral Service** | Referrers, Links, Attribution | PostgreSQL |
| 5 | **Reward Service** | Rewards, Balances, Payouts | PostgreSQL |
| 6 | **Analytics Service** | Reporting, Dashboards | ClickHouse |
| 7 | **AI Service** | Agents, Content Generation, Insights | PostgreSQL |
| 8 | **Integration Service** | Webhooks, 3rd Party, Emails, Notifications | PostgreSQL |

---

## Service 1: Tenant Service

**Domain:** Multi-tenancy, Account Management, Billing

### Responsibilities
- Tenant (organization) lifecycle
- Team member management
- Role-based access control
- Subscription & billing management
- Tenant settings & configuration
- Ory identity coordination

### Database: `tenant-db` (PostgreSQL)

```
Tenant
├── id (UUID)
├── name (display name / product name)
├── slug (subdomain: acme.referralapp.io)
│
├── # Company Information 🆕
├── company (JSONB)
│   ├── legal_name (official registered name)
│   ├── trading_name (if different from legal name)
│   ├── registration_number (Handelsregister, etc.)
│   ├── vat_number (DE123456789, ATU12345678, CHE-123.456.789)
│   ├── tax_id (for non-EU)
│   ├── legal_form (GmbH, AG, UG, SAS, SARL, etc.)
│   ├── industry
│   ├── company_size (1-10, 11-50, 51-200, 201-500, 500+)
│   ├── website_url
│   └── founded_year
│
├── # Billing Address 🆕
├── billing_address (JSONB)
│   ├── line1
│   ├── line2
│   ├── city
│   ├── state_province
│   ├── postal_code
│   ├── country_code (ISO 3166-1 alpha-2: DE, AT, CH, FR)
│   └── is_verified (boolean)
│
├── # Verification Status 🆕
├── verification (JSONB)
│   ├── status (pending | in_progress | verified | failed | manual_review)
│   ├── vat_verified (boolean)
│   ├── vat_verified_at
│   ├── vat_verification_response (VIES response)
│   ├── company_verified (boolean)
│   ├── company_verified_at
│   ├── company_verification_source (vies | handelsregister | opencorporates | manual)
│   ├── domain_verified (boolean)
│   ├── domain_verified_at
│   ├── verification_notes
│   └── verified_by (user_id if manual)
│
├── # Contact Information 🆕
├── contact (JSONB)
│   ├── billing_email (for invoices)
│   ├── billing_name
│   ├── technical_email (for API alerts)
│   └── phone
│
├── settings (JSONB)
│   ├── default_currency
│   ├── timezone
│   ├── locale (de-DE, en-US, fr-FR)
│   └── feature_flags
├── billing_plan (free, starter, growth, enterprise)
├── subscription_status (trialing, active, past_due, cancelled)
├── stripe_customer_id
├── stripe_subscription_id
├── payment_status (active, past_due, restricted, locked)
├── payment_failed_at
├── restriction_started_at
├── locked_at
├── deletion_scheduled_at
├── deletion_requested_by
├── trial_ends_at
├── onboarding_completed_at 🆕
├── created_at
└── updated_at

TeamMember
├── id
├── tenant_id → Tenant
├── ory_identity_id (from Ory)
├── email
├── name
├── role (owner, admin, editor, viewer)
├── permissions (JSONB override)
├── status (invited, active, removed)
├── invited_by
├── joined_at
├── removed_at
├── removed_by
└── created_at

AuditLog
├── id
├── tenant_id
├── user_id
├── user_email_snapshot
├── action (enum)
├── resource_type
├── resource_id
├── details (JSONB)
├── ip_address (INET)
├── created_at
-- Partitioned by created_at, archived to S3 after 90 days

ApiKey
├── id
├── tenant_id → Tenant
├── name
├── key_hash (bcrypt)
├── key_prefix (for identification: rk_live_abc...)
├── permissions (JSONB)
├── last_used_at
├── expires_at
└── created_at

VatValidationCache 🆕
├── id
├── vat_number (unique)
├── country_code
├── is_valid
├── company_name (from VIES)
├── company_address (from VIES)
├── vies_response (JSONB)
├── validated_at
├── expires_at (cache for 30 days)
└── created_at
```

### Company Verification Flow 🆕

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     COMPANY VERIFICATION FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  STEP 1: SIGNUP (Basic Info)                                                │
│  ───────────────────────────                                                │
│  User provides:                                                             │
│  ├── Email (personal or work)                                               │
│  ├── Password                                                               │
│  └── Product/Company name                                                   │
│  → Creates Ory identity + Tenant (minimal)                                  │
│  → Trial starts immediately                                                 │
│                                                                              │
│  STEP 2: ONBOARDING WIZARD (Company Details)                                │
│  ──────────────────────────────────────────                                 │
│  Prompted after first login, required before:                               │
│  - Creating first campaign                                                  │
│  - Upgrading to paid plan                                                   │
│                                                                              │
│  Collect:                                                                   │
│  ├── Company legal name                                                     │
│  ├── Country (determines VAT requirements)                                  │
│  ├── VAT number (required for EU B2B, optional for CH)                      │
│  ├── Company address                                                        │
│  ├── Billing email                                                          │
│  └── Website URL                                                            │
│                                                                              │
│  STEP 3: AUTOMATIC VERIFICATION                                             │
│  ──────────────────────────────                                             │
│                                                                              │
│  3a. VAT Verification (EU companies)                                        │
│      └── Call VIES API (free, official EU service)                          │
│          POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat │
│          ├── Valid → Get company name & address from VIES                   │
│          ├── Invalid → Show error, ask to correct                           │
│          └── Cache result for 30 days                                       │
│                                                                              │
│  3b. Swiss Companies (no VIES)                                              │
│      └── Option 1: UID Register API (Zefix)                                 │
│      └── Option 2: Accept without verification, flag for manual             │
│                                                                              │
│  3c. Domain Verification (optional, for trust)                              │
│      └── Check if signup email domain matches website                       │
│      └── Or: DNS TXT record verification                                    │
│                                                                              │
│  STEP 4: VERIFICATION OUTCOMES                                              │
│  ─────────────────────────────                                              │
│                                                                              │
│  ✅ VERIFIED (auto)                                                         │
│  ├── VAT valid via VIES                                                     │
│  ├── Company name matches                                                   │
│  └── Full access, VAT reverse charge applied                                │
│                                                                              │
│  ⚠️ MANUAL REVIEW                                                           │
│  ├── VAT valid but name mismatch                                            │
│  ├── Swiss company (no VIES)                                                │
│  ├── Non-EU company                                                         │
│  └── Admin reviews before paid plan                                         │
│                                                                              │
│  ❌ FAILED                                                                   │
│  ├── Invalid VAT number                                                     │
│  ├── Suspicious patterns                                                    │
│  └── Cannot upgrade until resolved                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### VAT Handling by Country 🆕

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VAT HANDLING MATRIX                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Your Company: Germany (DE)                                                 │
│                                                                              │
│  Customer Location    │ VAT ID Provided │ VAT Treatment                     │
│  ─────────────────────┼─────────────────┼────────────────────────────────── │
│  Germany (DE)         │ Yes             │ Charge 19% VAT (domestic)         │
│  Germany (DE)         │ No              │ Charge 19% VAT (domestic)         │
│  EU (non-DE)          │ Yes (valid)     │ Reverse charge (0% VAT)           │
│  EU (non-DE)          │ No              │ Charge DE 19% VAT                 │
│  Switzerland (CH)     │ N/A             │ No VAT (export, non-EU)           │
│  Rest of World        │ N/A             │ No VAT (export)                   │
│                                                                              │
│  Implementation:                                                            │
│  ├── Stripe Tax handles this automatically                                  │
│  ├── Pass customer.tax_ids to Stripe with validated VAT                     │
│  └── Stripe determines correct tax treatment                                │
│                                                                              │
│  Invoice Requirements:                                                      │
│  ├── DE domestic: Full invoice with VAT                                     │
│  ├── EU B2B reverse charge: "Reverse charge" note + customer VAT ID         │
│  ├── EU B2C: VAT charged at your rate                                       │
│  └── Non-EU: "Export" or "Not subject to VAT"                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### API Endpoints

```
# Tenant Management
POST   /tenants                    Create tenant (post-signup, minimal)
GET    /tenants/:id                Get tenant details
PUT    /tenants/:id                Update tenant
PUT    /tenants/:id/settings       Update settings
DELETE /tenants/:id                Schedule deletion (30-day grace)
POST   /tenants/:id/cancel-deletion Cancel scheduled deletion

# Company Information & Onboarding 🆕
PUT    /tenants/:id/company        Update company information
PUT    /tenants/:id/billing-address Update billing address
PUT    /tenants/:id/contact        Update contact information
GET    /tenants/:id/onboarding     Get onboarding status
POST   /tenants/:id/onboarding/complete Mark onboarding complete

# Company Verification 🆕
POST   /tenants/:id/verify-vat     Validate VAT number via VIES
GET    /tenants/:id/verification   Get verification status
POST   /tenants/:id/request-manual-review Request manual verification
POST   /admin/tenants/:id/verify   Admin: Manually verify company
POST   /admin/tenants/:id/reject-verification Admin: Reject with reason

# VAT Validation (Internal/Shared) 🆕
POST   /vat/validate               Validate any VAT number
GET    /vat/validate/:vatNumber    Check VAT (cached)

# Team Members
POST   /tenants/:id/members        Invite team member
GET    /tenants/:id/members        List team members
PUT    /members/:id                Update member role
DELETE /members/:id                Remove member (soft delete)

# API Keys
POST   /tenants/:id/api-keys       Create API key
GET    /tenants/:id/api-keys       List API keys
DELETE /api-keys/:id               Revoke API key

# Billing & Subscription
GET    /tenants/:id/usage          Get usage for billing
GET    /tenants/:id/subscription   Get subscription details
POST   /tenants/:id/subscription/checkout  Create Stripe checkout
POST   /tenants/:id/subscription/upgrade   Upgrade plan
POST   /tenants/:id/subscription/downgrade Schedule downgrade
POST   /tenants/:id/subscription/cancel    Cancel subscription
GET    /tenants/:id/invoices       List invoices
GET    /tenants/:id/payment-methods Get payment methods
POST   /tenants/:id/payment-methods Add payment method

# GDPR Compliance 🆕
POST   /tenants/:id/export         Request data export
GET    /tenants/:id/export/:exportId Get export status

# Webhooks (from Stripe)
POST   /webhooks/stripe            Handle Stripe events

# Internal
GET    /internal/tenants/:id/status Get tenant payment status (for other services)
```

### Events Published

```
tenant.created
tenant.updated
tenant.suspended
tenant.restricted 🆕
tenant.locked 🆕
tenant.restored 🆕
tenant.deletion_scheduled 🆕
tenant.deleted
member.invited
member.joined
member.removed
subscription.changed
payment.failed 🆕
payment.restored 🆕
```

### Account State Machine 🆕

```
                          ┌─────────┐
                          │ ACTIVE  │◄─────── Payment Success
                          └────┬────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
    ┌──────────┐        ┌───────────┐       ┌─────────────┐
    │ PAST_DUE │───────►│RESTRICTED │──────►│   LOCKED    │
    │ (0-7d)   │        │  (7-21d)  │       │   (21d+)    │
    └──────────┘        └───────────┘       └─────────────┘
          │                    │                    │
          └────────────────────┴────────────────────┘
                               │
                      Payment Success → ACTIVE
```

| State | Dashboard | Campaigns | Tracking | Duration |
|-------|-----------|-----------|----------|----------|
| active | Full | Running | ✅ | - |
| past_due | Full + warning | Running | ✅ | 0-7 days |
| restricted | Read-only | Running | ✅ | 7-21 days |
| locked | Payment page only | Paused | ❌ 402 | 21+ days |

---

## Service 2: Campaign Service

**Domain:** Campaign Management, Widget Config, Landing Pages

### Responsibilities
- Campaign CRUD & lifecycle (Temporal workflow)
- Reward rules configuration (json-rules-engine format)
- Widget configuration & customization
- Landing page configuration & content
- Campaign templates library
- Email templates management
- Media/asset references (stored in S3)
- Orchestrates AI Service for content generation

### Campaign Types (Pulses) 🆕

The platform supports multiple campaign types called "Pulses" - each designed for a specific engagement goal:

| Pulse Type | Goal | Trigger | Typical Reward |
|------------|------|---------|----------------|
| **referral** | Acquire new users via existing users | User shares link | Cash/credit to referrer + discount to referee |
| **signup** | Encourage signups (free users) | Visitor registers | Credit/discount to new user |
| **conversion** | Drive purchases | Free user pays | Cash/commission to referrer |
| **reactivation** | Re-engage dormant users | User inactive >X days | Credit/discount to returning user |
| **renewal** | Retain expiring subscriptions | Subscription ending soon | Discount on renewal |
| **cross_sell** | Upsell additional products/features | User on basic plan | Credit toward upgrade |
| **feedback** | Get reviews on G2, Capterra, etc. | User completes action | Gift card/credit |
| **switchup** | Acquire users from competitors | User from competitor signs up | Extended trial/bonus |
| **newsletter** | Grow email list | Visitor subscribes | Entry into giveaway |
| **education** | Increase feature adoption | User completes tutorial | Badge/credit |

### Database: `campaign-db` (PostgreSQL)

```
Campaign
├── id (UUID)
├── tenant_id
├── name
├── status (draft, active, paused, ended, scheduled)
├── type (referral | signup | conversion | reactivation | renewal | 
│         cross_sell | feedback | switchup | newsletter | education)
├── pulse_config (JSONB) 🆕 -- type-specific configuration
│   │
│   │ -- For referral/conversion pulses:
│   ├── attribution_model (first_touch | last_touch)
│   ├── cookie_duration_days (30, 60, 90)
│   ├── double_opt_in (boolean)
│   │
│   │ -- For reactivation pulse:
│   ├── inactivity_days (30, 60, 90)
│   ├── reactivation_action (login | purchase | feature_use)
│   │
│   │ -- For renewal pulse:
│   ├── days_before_expiry (7, 14, 30)
│   ├── renewal_discount_percent
│   │
│   │ -- For feedback pulse:
│   ├── platform (g2 | capterra | trustpilot | custom)
│   ├── verification_method (screenshot | api | manual)
│   ├── min_rating (4, 5)
│   │
│   │ -- For switchup pulse:
│   ├── competitor_domains[]
│   ├── proof_required (boolean)
│   │
│   │ -- For education pulse:
│   ├── required_actions[] (tutorial_complete | feature_used | quiz_passed)
│   └── completion_threshold (percentage)
│
├── trigger_config (JSONB) 🆕
│   ├── trigger_type (event | schedule | segment | manual)
│   ├── trigger_event (signup | login | purchase | custom)
│   ├── trigger_delay_hours
│   ├── trigger_segment_id
│   └── trigger_schedule (cron expression)
│
├── targeting (JSONB) 🆕
│   ├── include_segments[]
│   ├── exclude_segments[]
│   ├── user_properties (JSONB conditions)
│   └── geo_targets[]
│
├── rewards (JSONB)
│   ├── referrer
│   │   ├── type (cash | percentage | credit | points)
│   │   ├── value
│   │   ├── currency
│   │   ├── recurring (boolean)
│   │   ├── recurring_months (null = forever)
│   │   └── cap_amount
│   └── referee
│       ├── type (discount | credit | extended_trial | none)
│       ├── value
│       └── code_prefix
├── branding (JSONB)
│   ├── primary_color
│   ├── secondary_color
│   ├── logo_url (S3)
│   └── font_family
├── limits (JSONB) 🆕
│   ├── max_referrals_per_referrer
│   ├── max_total_referrals
│   ├── max_reward_budget
│   ├── current_spend
│   └── budget_alert_threshold
├── schedule (JSONB) 🆕
│   ├── start_date
│   ├── end_date
│   ├── timezone
│   └── active_days[] (mon, tue, ...)
├── workflow_id (Temporal workflow ID) 🆕
├── created_by
├── created_at
└── updated_at

RewardRule
├── id
├── campaign_id → Campaign
├── name
├── description
├── conditions (JSONB) -- json-rules-engine format
│   Example: {
│     "all": [
│       {"fact": "referral_count", "operator": "greaterThanInclusive", "value": 5},
│       {"fact": "conversion_value", "operator": "greaterThan", "value": 100}
│     ]
│   }
├── reward_type (bonus | multiplier | tier_upgrade)
├── reward_value (JSONB)
├── priority (for rule ordering)
├── is_active
└── created_at

WidgetConfig
├── id
├── campaign_id → Campaign
├── type (modal | inline | floating)
├── trigger (manual | auto | exit_intent | scroll)
├── position (bottom_right | bottom_left | center)
├── settings (JSONB)
│   ├── delay_seconds
│   ├── show_on_mobile
│   ├── z_index
│   └── animation
├── content (JSONB)
│   ├── headline
│   ├── subheadline
│   ├── cta_text
│   ├── share_message
│   └── success_message
├── styling (JSONB)
│   ├── colors (override branding)
│   ├── border_radius
│   ├── shadow
│   └── custom_css
├── features (JSONB)
│   ├── show_social_share (boolean)
│   ├── social_platforms[] (linkedin, twitter, whatsapp, email)
│   ├── show_qr_code (boolean)
│   ├── show_leaderboard (boolean)
│   └── show_rewards_balance (boolean)
├── is_active
└── updated_at

LandingPage
├── id
├── campaign_id → Campaign
├── slug (unique per tenant)
├── template_id → LandingPageTemplate
├── content (JSONB)
│   ├── headline
│   ├── subheadline
│   ├── hero_image_url
│   ├── benefits[] 
│   ├── cta_text
│   ├── testimonials[]
│   └── faq[]
├── seo (JSONB)
│   ├── title
│   ├── description
│   └── og_image_url
├── personalization (JSONB)
│   ├── show_referrer_name (boolean)
│   ├── show_referrer_photo (boolean)
│   └── custom_message_field
├── is_published
└── updated_at

LandingPageTemplate
├── id
├── tenant_id (null = system template)
├── name
├── category (modern, minimal, bold, corporate)
├── thumbnail_url
├── html_structure (JSONB schema)
├── default_content (JSONB)
├── is_system
└── created_at

CampaignTemplate
├── id
├── tenant_id (null = system template)
├── name
├── description
├── category (saas, developer_tool, ai_product, api)
├── config (JSONB - full campaign config)
├── is_ai_generated
├── ai_generation_id (reference to AI Service)
├── source_url (if AI analyzed)
└── created_at

EmailTemplate
├── id
├── campaign_id → Campaign (null = system default)
├── type (referral_invite | signup_notification | reward_earned | 
│         payout_sent | weekly_summary | welcome)
├── name
├── subject
├── html_content
├── text_content
├── variables[] (available merge fields)
├── is_ai_generated
├── ai_generation_id (reference to AI Service)
└── updated_at
```

### API Endpoints

```
# Campaigns
POST   /campaigns                      Create campaign
GET    /campaigns                      List campaigns
GET    /campaigns/:id                  Get campaign
PUT    /campaigns/:id                  Update campaign
DELETE /campaigns/:id                  Delete campaign
POST   /campaigns/:id/duplicate        Clone campaign
POST   /campaigns/:id/activate         Start campaign
POST   /campaigns/:id/pause            Pause campaign
POST   /campaigns/:id/end              End campaign

# Reward Rules
POST   /campaigns/:id/rules            Create reward rule
GET    /campaigns/:id/rules            List rules
PUT    /rules/:id                      Update rule
DELETE /rules/:id                      Delete rule
POST   /rules/validate                 Validate rule syntax

# Widget
GET    /campaigns/:id/widget           Get widget config
PUT    /campaigns/:id/widget           Update widget config
GET    /widget/config/:tenantId/:campaignId  Public: Get widget config (cached)

# Landing Pages
POST   /campaigns/:id/landing-page     Create landing page
GET    /campaigns/:id/landing-page     Get landing page config
PUT    /landing-pages/:id              Update landing page
GET    /l/:tenantSlug/:pageSlug        Public: Render landing page
GET    /landing-pages/templates        List templates

# Email Templates
GET    /campaigns/:id/emails           List email templates
PUT    /emails/:id                     Update email template
POST   /emails/:id/preview             Preview with sample data

# AI-Powered (proxies to AI Service)
POST   /campaigns/ai/analyze-url       Analyze URL → calls AI Service
POST   /campaigns/ai/generate          Generate campaign → calls AI Service
POST   /campaigns/ai/builder/start     Start AI chat → calls AI Service
POST   /campaigns/ai/builder/message   Chat message → calls AI Service
```

### Events Published

```
campaign.created
campaign.activated
campaign.paused
campaign.ended
campaign.updated
campaign.deleted
campaign.budget_alert      🆕
campaign.budget_exhausted  🆕
pulse.triggered            🆕
pulse.completed            🆕
```

### Campaign Temporal Workflows 🆕

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CAMPAIGN LIFECYCLE WORKFLOW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────┐    activate()    ┌─────────┐    pause()     ┌─────────┐      │
│   │  DRAFT  │─────────────────►│ ACTIVE  │───────────────►│ PAUSED  │      │
│   └─────────┘                  └────┬────┘                └────┬────┘      │
│        │                            │                          │           │
│        │ schedule()                 │ end() or                 │ resume() │
│        ▼                            │ budget exhausted         ▼           │
│   ┌───────────┐                     │                    ┌─────────┐      │
│   │ SCHEDULED │─────────────────────┼───────────────────►│ ACTIVE  │      │
│   └───────────┘  (at start_date)    │                    └─────────┘      │
│                                     ▼                                      │
│                               ┌─────────┐                                  │
│                               │  ENDED  │                                  │
│                               └─────────┘                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**CampaignLifecycleWorkflow (Temporal)**

```typescript
@Workflow()
export class CampaignLifecycleWorkflow {
  private state: CampaignState = 'draft';
  private campaign: Campaign;
  
  @WorkflowMethod()
  async run(campaignId: string) {
    this.campaign = await activities.loadCampaign(campaignId);
    
    // Wait for signals or scheduled events
    while (this.state !== 'ended') {
      await condition(() => this.stateChanged, '1d');
      
      // Check scheduled start
      if (this.state === 'scheduled' && Date.now() >= this.campaign.schedule.start_date) {
        await this.activate();
      }
      
      // Check scheduled end
      if (this.state === 'active' && this.campaign.schedule.end_date && 
          Date.now() >= this.campaign.schedule.end_date) {
        await this.end('scheduled_end');
      }
      
      // Check budget
      if (this.state === 'active') {
        const spend = await activities.getCurrentSpend(campaignId);
        if (spend >= this.campaign.limits.max_reward_budget) {
          await this.end('budget_exhausted');
        } else if (spend >= this.campaign.limits.budget_alert_threshold) {
          await activities.sendBudgetAlert(campaignId, spend);
        }
      }
    }
  }
  
  @SignalMethod()
  async activate() {
    await activities.validateCampaign(this.campaign.id);
    await activities.invalidateCDNCache(this.campaign.tenant_id);
    await activities.notifyIntegrations('campaign.activated', this.campaign);
    await activities.scheduleReactivationChecks(this.campaign); // For reactivation pulse
    this.state = 'active';
  }
  
  @SignalMethod()
  async pause() {
    await activities.notifyActiveReferrers(this.campaign.id, 'paused');
    await activities.invalidateCDNCache(this.campaign.tenant_id);
    this.state = 'paused';
  }
  
  @SignalMethod()
  async end(reason: string) {
    await activities.finalizeRewards(this.campaign.id);
    await activities.notifyActiveReferrers(this.campaign.id, 'ended');
    await activities.generateCampaignReport(this.campaign.id);
    this.state = 'ended';
  }
}
```

### Pulse-Specific Workflows 🆕

**1. Referral Pulse (Classic)**
```
Trigger: User shares referral link
Flow:
  1. Click tracked → cookie set
  2. Signup tracked → attribution check
  3. Conversion tracked → reward calculated
  4. AI fraud check → auto-approve/escalate
  5. Payout scheduled
```

**2. Reactivation Pulse**
```
Trigger: User inactive for X days (configured in pulse_config.inactivity_days)
Flow:
  1. Daily cron job checks inactive users
  2. Match users to reactivation campaign segments
  3. Send reactivation email/notification
  4. Track reactivation event (login, purchase, etc.)
  5. Reward on successful reactivation

Temporal Workflow: ReactivationCheckWorkflow
├── Query users last_active < NOW() - inactivity_days
├── Filter by targeting.include_segments
├── For each user:
│   ├── Check if already contacted
│   ├── Send via Integration Service
│   └── Schedule follow-up
└── On reactivation event → trigger reward
```

**3. Renewal Pulse**
```
Trigger: Subscription expiring in X days
Flow:
  1. Daily job checks subscriptions ending soon
  2. Match to renewal campaign
  3. Send renewal reminder with discount code
  4. Track renewal event
  5. Reward on successful renewal

Temporal Workflow: RenewalReminderWorkflow
├── Query subscriptions expiring in pulse_config.days_before_expiry
├── For each subscription:
│   ├── Generate unique discount code
│   ├── Send renewal email
│   └── Schedule follow-ups (7d, 3d, 1d before)
└── On renewal event → mark campaign success
```

**4. Feedback Pulse**
```
Trigger: User completes qualifying action (purchase, milestone, etc.)
Flow:
  1. Qualifying event received
  2. Check eligibility (e.g., paid user, >30 days)
  3. Send feedback request
  4. User submits review on G2/Capterra/etc.
  5. Verification (screenshot, API check, manual)
  6. Reward on verification

Verification Methods:
├── screenshot: User uploads screenshot, AI/manual verify
├── api: Poll G2/Capterra API for new reviews
└── manual: Admin approves after checking

Temporal Workflow: FeedbackRequestWorkflow
├── Check user eligibility
├── Send feedback request email
├── Wait for submission (timeout: 14 days)
├── On submission:
│   ├── If screenshot: Queue for verification
│   ├── If API: Check platform API
│   └── If manual: Add to review queue
└── On verification → trigger reward
```

**5. Switchup Pulse (Competitor Acquisition)**
```
Trigger: User from competitor signs up
Flow:
  1. Signup with competitor email domain or self-declared
  2. Verify competitor usage (optional proof)
  3. Extended trial or bonus applied
  4. Track successful conversion
  5. Reward on paid conversion

Detection Methods:
├── Email domain matching (pulse_config.competitor_domains)
├── UTM parameter (utm_source=competitor_name)
├── Self-declaration in signup flow
└── Import from competitor (data migration)
```

**6. Cross-Sell Pulse**
```
Trigger: User on basic plan eligible for upgrade
Flow:
  1. Identify users matching upgrade criteria
  2. Send cross-sell campaign
  3. Track upgrade/add-on purchase
  4. Reward on successful upsell

Temporal Workflow: CrossSellWorkflow
├── Query users matching targeting criteria
├── Filter by current plan, usage metrics
├── For each user:
│   ├── Determine best upsell offer
│   ├── Send personalized campaign
│   └── Track engagement
└── On upgrade event → trigger reward
```

**7. Education Pulse**
```
Trigger: User hasn't completed key onboarding steps
Flow:
  1. Track user progress against required_actions
  2. Send educational content/prompts
  3. Track completion of each action
  4. Reward on reaching completion_threshold

Progress Tracking:
├── tutorial_complete: User finishes onboarding
├── feature_used: User tries specific feature
├── quiz_passed: User completes knowledge check
└── milestone_reached: User hits usage milestone
```

### Pulse Trigger Engine 🆕

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PULSE TRIGGER ENGINE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Event-Based Triggers (Real-time)                                           │
│  ─────────────────────────────────                                          │
│  tracker.signup.received ──────► Check signup/referral pulses               │
│  tracker.conversion.received ──► Check conversion pulses                    │
│  user.login ───────────────────► Check reactivation pulse completion        │
│  subscription.created ─────────► Schedule renewal pulse                     │
│  subscription.cancelled ───────► Check win-back pulse (future)              │
│                                                                              │
│  Schedule-Based Triggers (Cron)                                             │
│  ──────────────────────────────                                             │
│  Daily 9:00 AM ────────────────► Reactivation check job                     │
│  Daily 9:00 AM ────────────────► Renewal reminder job                       │
│  Daily 9:00 AM ────────────────► Cross-sell eligibility job                 │
│  Weekly Monday ────────────────► Education progress check                   │
│                                                                              │
│  Segment-Based Triggers                                                      │
│  ──────────────────────                                                     │
│  User enters segment ──────────► Trigger matching pulse campaigns           │
│  User exits segment ───────────► Cancel pending pulse workflows             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Service 3: Tracker Service

**Domain:** Public Event Tracking, SDK Backend

### Responsibilities
- Track referral link clicks (high volume, no auth)
- Track signup events (from customer's backend)
- Track conversion events (from customer's backend)
- Track custom events
- SDK session management
- First-party cookie coordination
- SSE real-time updates to widget
- Event validation & enrichment

### Characteristics
- **Public endpoints** (no JWT, API key in header/query)
- **High throughput** (thousands of events/second)
- **Low latency** (<50ms response)
- **Stateless** (scales horizontally)
- **Write-heavy** (optimized for inserts)

### Database: `tracker-db` (PostgreSQL, partitioned by date)

```
ClickEvent (partitioned by clicked_at)
├── id (UUID)
├── tenant_id
├── campaign_id
├── link_id
├── referrer_id
├── visitor_id (anonymous, from cookie)
├── ip_hash (hashed for privacy)
├── user_agent
├── referer_url
├── country (from IP)
├── city
├── device_type (desktop | mobile | tablet)
├── browser
├── os
├── utm_params (JSONB)
├── clicked_at (timestamp)
└── processed (boolean, for async enrichment)

SignupEvent
├── id (UUID)
├── tenant_id
├── campaign_id
├── referrer_id (attributed)
├── referee_email
├── referee_external_id (customer's user ID)
├── visitor_id (links to click)
├── attribution_data (JSONB)
│   ├── click_id
│   ├── link_id
│   ├── time_to_signup_seconds
│   └── attribution_model_used
├── metadata (JSONB, customer-provided)
├── signed_up_at
└── created_at

ConversionEvent
├── id (UUID)
├── tenant_id
├── campaign_id
├── referrer_id
├── referral_id → (in Referral Service)
├── type (trial_start | paid | upgrade | renewal)
├── value_amount
├── value_currency
├── product_id (customer's product)
├── plan_id (customer's plan)
├── is_recurring
├── subscription_interval (month | year)
├── metadata (JSONB)
├── converted_at
└── created_at

TrackerSession
├── id (UUID)
├── tenant_id
├── visitor_id
├── first_party_cookie_id
├── referrer_id (null until identified)
├── attribution (JSONB)
│   ├── first_click_id
│   ├── first_click_at
│   ├── last_click_id
│   ├── last_click_at
│   └── click_count
├── identified_at
├── created_at
└── expires_at
```

### API Endpoints

```
# Public Tracking (API Key in header or query param)
GET    /t/c/:shortCode                 Track click (redirect)
POST   /t/click                        Track click (API)
POST   /t/signup                       Track signup event
POST   /t/conversion                   Track conversion event
POST   /t/event                        Track custom event

# SDK Endpoints
POST   /sdk/session                    Create/update session
POST   /sdk/identify                   Identify visitor as referrer
GET    /sdk/sse/:sessionId             SSE stream for real-time updates
GET    /sdk/config/:campaignId         Get SDK config (cached via CDN)

# Internal (service-to-service)
GET    /internal/attribution/:visitorId   Get attribution data
POST   /internal/enrich                    Batch enrich events (async)
```

### Events Published

```
tracker.click.received
tracker.signup.received
tracker.conversion.received
tracker.custom_event.received
```

### Behavior by Account State 🆕

The Tracker Service checks tenant payment status before processing events.

| Account State | Click Redirect | Track Events | SDK Config | Landing Pages |
|---------------|----------------|--------------|------------|---------------|
| **active** | ✅ Track + redirect | ✅ Accept | ✅ Return config | ✅ Render |
| **past_due** | ✅ Track + redirect | ✅ Accept | ✅ Return config | ✅ Render |
| **restricted** | ✅ Track + redirect | ✅ Accept | ✅ Return config | ✅ Render |
| **locked** | ⚠️ Redirect only (no track) | ❌ 402 | ⚠️ `{status: "paused"}` | ⚠️ "Program paused" |
| **deleted** | ❌ 404 | ❌ 404 | ❌ 404 | ❌ 404 |

**Why continue tracking during past_due/restricted?**
- Don't break customer's website/product
- Preserve attribution data (they may pay)
- Avoid support burden from broken referrals
- Only stop when truly locked (21+ days unpaid)

### Implementation Notes

```
On every request:
1. Extract tenant_id from API key or URL
2. Check Redis cache for tenant status (5 min TTL)
3. If not cached, call Tenant Service /internal/tenants/:id/status
4. Apply behavior based on status
```

### Performance Optimizations

```
- Async processing: Accept event → publish to SQS → respond immediately
- Batch inserts: Accumulate events, insert in batches
- Read replicas: For any read queries
- Partitioning: Daily partitions for ClickEvent table
- Indexes: Composite indexes on (tenant_id, campaign_id, clicked_at)
- CDN: Widget config cached at CloudFront edge
```

---

## Service 4: Referral Service

**Domain:** Referrer Management, Links, Attribution

### Responsibilities
- Referrer registration & lifecycle
- Referral link generation
- QR code generation (via S3)
- Referral attribution (first-touch/last-touch)
- Referral lifecycle (pending → signed_up → converted → churned)
- Fraud detection (basic rules)

### Database: `referral-db` (PostgreSQL)

```
Referrer
├── id (UUID)
├── tenant_id
├── campaign_id
├── external_user_id (customer's user ID)
├── email
├── name
├── referral_code (unique per tenant, e.g., "JOHN20")
├── status (active | inactive | blocked | pending_verification)
├── fraud_score (0-100)
├── fraud_flags (JSONB)
├── metadata (JSONB, customer-provided)
├── stats (JSONB, denormalized)
│   ├── total_clicks
│   ├── total_signups
│   ├── total_conversions
│   ├── total_revenue
│   └── last_referral_at
├── created_at
└── updated_at

ReferralLink
├── id (UUID)
├── referrer_id → Referrer
├── campaign_id
├── short_code (e.g., "abc123")
├── destination_url
├── utm_source
├── utm_medium
├── utm_campaign
├── utm_content
├── custom_params (JSONB)
├── qr_code_url (S3)
├── is_active
├── click_count (denormalized)
├── created_at
└── updated_at

Referral
├── id (UUID)
├── tenant_id
├── campaign_id
├── referrer_id → Referrer
├── referee_email
├── referee_external_id
├── referee_name
├── status (pending | signed_up | converted | churned | blocked)
├── attribution (JSONB)
│   ├── model_used (first_touch | last_touch)
│   ├── attributed_click_id
│   ├── attributed_link_id
│   ├── first_touch_at
│   ├── last_touch_at
│   └── touchpoints[] 
├── conversion_data (JSONB)
│   ├── converted_at
│   ├── conversion_value
│   ├── product_id
│   ├── plan_id
│   └── is_recurring
├── fraud_check (JSONB)
│   ├── passed (boolean)
│   ├── checks_performed[]
│   └── flags[]
├── signed_up_at
├── converted_at
├── churned_at
└── created_at

FraudRule
├── id
├── tenant_id (null = system rule)
├── name
├── type (self_referral | duplicate_email | same_ip | velocity)
├── conditions (JSONB)
├── action (block | flag | allow)
├── is_active
└── created_at
```

### API Endpoints

```
# Referrers (Admin)
POST   /referrers                      Register referrer
GET    /referrers                      List referrers
GET    /referrers/:id                  Get referrer details
PUT    /referrers/:id                  Update referrer
PUT    /referrers/:id/status           Change status (block/unblock)
DELETE /referrers/:id                  Remove referrer
GET    /referrers/search               Search by email/code

# Referrers (Portal - referrer's own view)
GET    /portal/me                      Get own profile
PUT    /portal/me                      Update own profile
GET    /portal/me/stats                Get own stats
GET    /portal/me/referrals            List own referrals

# Links
POST   /referrers/:id/links            Create link
GET    /referrers/:id/links            List links
PUT    /links/:id                      Update link
DELETE /links/:id                      Deactivate link
POST   /links/:id/qr-code              Generate QR code

# Referrals
GET    /referrals                      List referrals
GET    /referrals/:id                  Get referral details
PUT    /referrals/:id/status           Update referral status
POST   /referrals/:id/reattribute      Manual reattribution

# Referral Codes
GET    /codes/:code/validate           Validate referral code (public)
POST   /codes/check-availability       Check if code available

# Internal
POST   /internal/attribute             Attribute signup to referrer
POST   /internal/convert               Mark referral as converted
POST   /internal/fraud-check           Run fraud checks
```

### Events Published

```
referrer.created
referrer.updated
referrer.blocked
referral.created
referral.attributed
referral.converted
referral.churned
```

### Event Handlers (from Tracker Service)

```
tracker.signup.received → Create Referral, attribute, fraud check
tracker.conversion.received → Update Referral status, trigger reward
```

---

## Service 5: Reward Service

**Domain:** Reward Calculation, Rules Engine, Balances, Payouts

### Responsibilities
- Calculate rewards based on rules (json-rules-engine)
- Evaluate attribution rules and conditions
- Track reward lifecycle (pending → approved → paid)
- Manage referrer balances
- Process reward adjustments (refunds, chargebacks)
- Payout processing (PayPal, Wise, Bank Transfer)
- Coordinate with AI Service for auto-approval
- Tax form collection (future)
- Payout scheduling

### Reward Lifecycle 🆕

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REWARD LIFECYCLE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   EVENT     │───►│ CALCULATE   │───►│ AI REVIEW   │───►│   APPROVE   │  │
│  │  RECEIVED   │    │   REWARD    │    │  (Fraud +   │    │  (or REJECT)│  │
│  └─────────────┘    └─────────────┘    │   Risk)     │    └──────┬──────┘  │
│                                         └─────────────┘           │         │
│                                                                   ▼         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   PAID      │◄───│  PAYOUT     │◄───│   BALANCE   │◄───│  CREDITED   │  │
│  │             │    │  PROCESSED  │    │   UPDATED   │    │             │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

Status Flow:
  pending → approved → credited → paid
                    ↘ rejected
                    ↘ adjusted (on refund/chargeback)
```

### Reward Rules Engine (json-rules-engine) 🆕

```javascript
// Example: Tiered commission based on referral count and value

const rewardRules = [
  {
    name: "Base Commission",
    priority: 1,
    conditions: {
      all: [
        { fact: "conversion_type", operator: "equal", value: "paid" },
        { fact: "referral_valid", operator: "equal", value: true }
      ]
    },
    event: {
      type: "apply_reward",
      params: {
        reward_type: "percentage",
        value: 10,  // 10% commission
        recurring: true,
        recurring_months: 12
      }
    }
  },
  {
    name: "Silver Tier Bonus",
    priority: 2,
    conditions: {
      all: [
        { fact: "referrer_total_referrals", operator: "greaterThanInclusive", value: 5 },
        { fact: "referrer_total_referrals", operator: "lessThan", value: 20 }
      ]
    },
    event: {
      type: "apply_bonus",
      params: {
        bonus_type: "multiplier",
        value: 1.25  // 25% bonus on commission
      }
    }
  },
  {
    name: "Gold Tier Bonus",
    priority: 2,
    conditions: {
      all: [
        { fact: "referrer_total_referrals", operator: "greaterThanInclusive", value: 20 }
      ]
    },
    event: {
      type: "apply_bonus",
      params: {
        bonus_type: "multiplier",
        value: 1.5  // 50% bonus on commission
      }
    }
  },
  {
    name: "High Value Conversion Bonus",
    priority: 3,
    conditions: {
      all: [
        { fact: "conversion_value", operator: "greaterThan", value: 500 }
      ]
    },
    event: {
      type: "apply_bonus",
      params: {
        bonus_type: "fixed",
        value: 50,
        currency: "EUR"
      }
    }
  },
  {
    name: "First Referral Bonus",
    priority: 4,
    conditions: {
      all: [
        { fact: "is_first_referral", operator: "equal", value: true }
      ]
    },
    event: {
      type: "apply_bonus",
      params: {
        bonus_type: "fixed",
        value: 25,
        currency: "EUR"
      }
    }
  }
];

// Available Facts for Rules
const facts = {
  // Conversion facts
  conversion_type: "paid" | "trial" | "upgrade" | "renewal",
  conversion_value: number,
  conversion_currency: string,
  product_id: string,
  plan_id: string,
  is_recurring: boolean,
  
  // Referral facts
  referral_valid: boolean,
  referral_age_days: number,
  attribution_model: "first_touch" | "last_touch",
  time_to_convert_days: number,
  
  // Referrer facts
  referrer_total_referrals: number,
  referrer_total_conversions: number,
  referrer_total_revenue: number,
  referrer_tier: "bronze" | "silver" | "gold" | "platinum",
  referrer_age_days: number,
  is_first_referral: boolean,
  
  // Campaign facts
  campaign_type: string,
  campaign_active_days: number,
  
  // Fraud facts (from AI Fraud Agent)
  fraud_risk_score: number,
  fraud_flags: string[]
};
```

### Reward Calculation Flow 🆕

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    REWARD CALCULATION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Conversion Event Received                                               │
│     └── tracker.conversion.received                                         │
│                                                                              │
│  2. Load Context                                                            │
│     ├── Campaign config & reward rules                                      │
│     ├── Referrer stats & tier                                               │
│     ├── Referral details & attribution                                      │
│     └── AI Fraud Agent risk assessment                                      │
│                                                                              │
│  3. Build Facts Object                                                      │
│     {                                                                        │
│       conversion_type: "paid",                                              │
│       conversion_value: 99.00,                                              │
│       referrer_total_referrals: 12,                                         │
│       fraud_risk_score: 15,                                                 │
│       ...                                                                   │
│     }                                                                        │
│                                                                              │
│  4. Run Rules Engine                                                        │
│     const results = await engine.run(facts);                                │
│     // Returns: [base_commission, tier_bonus, ...]                          │
│                                                                              │
│  5. Calculate Final Reward                                                  │
│     base = conversion_value * 0.10 = €9.90                                  │
│     tier_bonus = base * 1.25 = €12.38                                       │
│     cap = min(tier_bonus, campaign.rewards.referrer.cap_amount)             │
│     final = €12.38                                                          │
│                                                                              │
│  6. Create Reward Record                                                    │
│     {                                                                        │
│       amount: 12.38,                                                        │
│       currency: "EUR",                                                      │
│       status: "pending",                                                    │
│       calculation: {                                                        │
│         base_value: 99.00,                                                  │
│         commission_rate: 0.10,                                              │
│         rules_applied: ["base_commission", "silver_tier_bonus"],            │
│         bonuses: [{ type: "multiplier", value: 1.25 }],                     │
│         cap_applied: false                                                  │
│       }                                                                      │
│     }                                                                        │
│                                                                              │
│  7. Publish reward.created Event                                            │
│     └── AI Reward Agent consumes for approval decision                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### AI-Powered Reward Approval Flow 🆕

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AI REWARD APPROVAL FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  reward.created event consumed by AI Service                                │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    AI REWARD AGENT                                    │   │
│  │                                                                       │   │
│  │  Input:                                                               │   │
│  │  ├── Reward details (amount, campaign, referrer)                     │   │
│  │  ├── Fraud Agent risk_score and flags                                │   │
│  │  ├── Referrer history (past rewards, approval rate)                  │   │
│  │  └── Campaign auto_approve_threshold                                 │   │
│  │                                                                       │   │
│  │  Decision Matrix:                                                     │   │
│  │  ┌─────────────────────┬──────────────┬─────────────────────────┐   │   │
│  │  │ Risk Score          │ Confidence   │ Decision                │   │   │
│  │  ├─────────────────────┼──────────────┼─────────────────────────┤   │   │
│  │  │ 0-20 (low)          │ > 90%        │ AUTO_APPROVE            │   │   │
│  │  │ 0-20 (low)          │ < 90%        │ AUTO_APPROVE            │   │   │
│  │  │ 21-50 (medium-low)  │ > 95%        │ AUTO_APPROVE            │   │   │
│  │  │ 21-50 (medium-low)  │ < 95%        │ ESCALATE                │   │   │
│  │  │ 51-70 (medium)      │ any          │ ESCALATE                │   │   │
│  │  │ 71-85 (high)        │ > 90%        │ AUTO_REJECT             │   │   │
│  │  │ 71-85 (high)        │ < 90%        │ ESCALATE                │   │   │
│  │  │ 86-100 (critical)   │ any          │ AUTO_REJECT             │   │   │
│  │  └─────────────────────┴──────────────┴─────────────────────────┘   │   │
│  │                                                                       │   │
│  │  Output:                                                              │   │
│  │  {                                                                    │   │
│  │    decision: "auto_approve" | "escalate" | "auto_reject",            │   │
│  │    confidence: 0.94,                                                  │   │
│  │    reason: "Low risk score, established referrer, normal amount",    │   │
│  │    factors: [                                                         │   │
│  │      { factor: "fraud_score", value: 12, impact: "positive" },       │   │
│  │      { factor: "referrer_history", value: "15 approved", impact: "positive" },
│  │      { factor: "amount", value: "€12.38", impact: "neutral" }        │   │
│  │    ]                                                                  │   │
│  │  }                                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  On AUTO_APPROVE:                                                           │
│  ├── Update reward.status = 'approved'                                      │
│  ├── Update reward.approved_by = 'ai_agent'                                │
│  ├── Update reward.approved_at = now()                                      │
│  ├── Update reward.ai_decision = { ... }                                   │
│  ├── Credit referrer balance                                                │
│  ├── Publish reward.approved                                                │
│  └── Publish ai.reward.auto_approved                                       │
│                                                                              │
│  On ESCALATE:                                                               │
│  ├── Update reward.status = 'pending_review'                               │
│  ├── Update reward.ai_decision = { ... }                                   │
│  ├── Add to manual review queue                                            │
│  ├── Publish ai.reward.escalated                                           │
│  └── Notify admin via Integration Service                                  │
│                                                                              │
│  On AUTO_REJECT:                                                            │
│  ├── Update reward.status = 'rejected'                                      │
│  ├── Update reward.rejected_by = 'ai_agent'                                │
│  ├── Update reward.rejection_reason = reason                               │
│  ├── Publish reward.rejected                                                │
│  ├── Publish ai.reward.auto_rejected                                       │
│  └── Log for audit                                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Database: `reward-db` (PostgreSQL)

```
Reward
├── id (UUID)
├── tenant_id
├── campaign_id
├── referrer_id
├── referral_id
├── pulse_type (referral | conversion | reactivation | ...) 🆕
├── trigger_event_id 🆕
├── type (cash | percentage | credit | discount_given | points)
├── status (pending | pending_review | approved | rejected | credited | paid | adjusted)
├── amount
├── currency
├── calculation (JSONB) 🆕 expanded
│   ├── base_value (conversion amount)
│   ├── commission_rate
│   ├── rules_applied[] (rule IDs that fired)
│   ├── bonuses[]
│   │   ├── type (multiplier | fixed | tier)
│   │   ├── value
│   │   └── rule_id
│   ├── subtotal (before cap)
│   ├── cap_applied (boolean)
│   └── cap_amount
├── ai_decision (JSONB) 🆕
│   ├── decision (auto_approve | escalate | auto_reject)
│   ├── confidence
│   ├── risk_score
│   ├── reason
│   ├── factors[]
│   └── decided_at
├── is_recurring
├── recurrence_month (for recurring)
├── parent_reward_id (for recurring, links to original) 🆕
├── approved_by (user_id | "ai_agent" | null)
├── approved_at
├── rejected_by 🆕
├── rejection_reason 🆕
├── credited_at 🆕
├── paid_at
├── payout_id
├── adjustment_reason 🆕
├── adjusted_amount 🆕
├── notes
├── created_at
└── updated_at

RewardBalance
├── id
├── tenant_id
├── referrer_id
├── currency
├── available (can withdraw)
├── pending (awaiting approval)
├── lifetime_earned
├── lifetime_paid
├── lifetime_adjusted
├── updated_at

BalanceTransaction
├── id
├── balance_id → RewardBalance
├── type (credit | debit | adjustment | payout)
├── amount
├── description
├── reference_type (reward | payout | adjustment)
├── reference_id
├── created_at

PayoutMethod
├── id
├── tenant_id
├── referrer_id
├── type (paypal | wise | bank_sepa | credit)
├── is_default
├── status (pending_verification | verified | failed)
├── details (encrypted JSONB)
│   PayPal: { email }
│   Wise: { email, account_id }
│   Bank: { iban, bic, account_holder }
├── verified_at
├── created_at
└── updated_at

Payout
├── id (UUID)
├── tenant_id
├── referrer_id
├── payout_method_id → PayoutMethod
├── status (pending | processing | completed | failed | cancelled)
├── amount
├── currency
├── fee
├── net_amount
├── reward_ids[] (included rewards)
├── provider (paypal | wise | manual)
├── provider_reference
├── provider_response (JSONB)
├── failure_reason
├── initiated_at
├── completed_at
├── created_at

PayoutSchedule
├── id
├── tenant_id
├── is_enabled
├── frequency (weekly | biweekly | monthly)
├── day_of_period (1-7 for weekly, 1-28 for monthly)
├── minimum_threshold
├── auto_approve (boolean)
├── next_run_at
└── updated_at
```

### API Endpoints

```
# Rewards (Admin)
GET    /rewards                        List rewards (with filters)
GET    /rewards/:id                    Get reward details
GET    /rewards/review-queue           Get pending_review rewards 🆕
POST   /rewards/:id/approve            Manual approve (for escalated)
POST   /rewards/:id/reject             Manual reject (for escalated)
POST   /rewards/:id/adjust             Adjust reward amount
POST   /rewards/batch-approve          Bulk approve
GET    /rewards/recurring              List recurring reward chains 🆕
GET    /rewards/:id/history            Get reward audit history 🆕

# Recurring Rewards 🆕
GET    /recurring-rewards              List all recurring reward configs
GET    /recurring-rewards/:id          Get recurring reward chain
POST   /recurring-rewards/:id/cancel   Cancel future recurring rewards

# Balances
GET    /balances                       List all balances
GET    /referrers/:id/balance          Get referrer balance
GET    /referrers/:id/transactions     Get balance history

# Payout Methods
POST   /referrers/:id/payout-methods   Add payout method
GET    /referrers/:id/payout-methods   List payout methods
PUT    /payout-methods/:id             Update method
DELETE /payout-methods/:id             Remove method
POST   /payout-methods/:id/verify      Verify method

# Payouts (Admin)
GET    /payouts                        List payouts
POST   /payouts                        Create manual payout
GET    /payouts/:id                    Get payout details
POST   /payouts/:id/process            Process payout
POST   /payouts/:id/retry              Retry failed payout
POST   /payouts/:id/cancel             Cancel payout

# Payouts (Portal - referrer view)
GET    /portal/me/balance              Get own balance
GET    /portal/me/rewards              List own rewards
GET    /portal/me/payouts              List own payouts
POST   /portal/me/request-payout       Request payout

# Payout Schedule
GET    /payout-schedule                Get schedule config
PUT    /payout-schedule                Update schedule

# Internal (service-to-service)
POST   /internal/calculate-reward      Calculate reward for event
POST   /internal/rewards/:id/approve   AI agent approves reward 🆕
POST   /internal/rewards/:id/reject    AI agent rejects reward 🆕
POST   /internal/process-scheduled     Process scheduled payouts (cron)
POST   /internal/process-recurring     Process recurring rewards (monthly) 🆕
POST   /internal/adjustment            Process refund/chargeback adjustment 🆕
```

### Events Published

```
reward.created
reward.pending_review 🆕
reward.approved
reward.rejected
reward.credited 🆕
reward.adjusted
reward.paid
reward.recurring.created 🆕
reward.recurring.cancelled 🆕
payout.initiated
payout.processing
payout.completed
payout.failed
```

### Event Handlers

```
referral.converted → Calculate reward, create pending reward
referral.churned → Adjust/cancel pending rewards
tracker.renewal.received → Create renewal reward (for recurring)
ai.reward.auto_approved → Update reward status 🆕
ai.reward.auto_rejected → Update reward status 🆕
ai.reward.escalated → Add to review queue 🆕
stripe.charge.refunded → Adjust related rewards 🆕
stripe.subscription.cancelled → Cancel recurring rewards 🆕
```

### Recurring Rewards Processing 🆕

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RECURRING REWARDS FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Monthly Cron Job (1st of month):                                           │
│  ─────────────────────────────────                                          │
│  1. Find all active recurring rewards where:                                │
│     - parent reward is paid                                                 │
│     - next_recurrence_date <= today                                         │
│     - recurrence_count < recurring_months (or infinite)                     │
│     - referral is not churned                                               │
│                                                                              │
│  2. For each recurring reward:                                              │
│     - Check if subscription is still active (via Integration Service)      │
│     - Calculate new reward amount (same % of current subscription)         │
│     - Create new Reward with parent_reward_id                               │
│     - Send through AI approval flow                                         │
│     - Update next_recurrence_date                                           │
│                                                                              │
│  3. Handle churned subscriptions:                                           │
│     - Mark recurring reward chain as cancelled                              │
│     - Don't create new rewards                                              │
│                                                                              │
│  Example Timeline:                                                           │
│  ──────────────────                                                          │
│  Month 0: Conversion → Reward #1 created (parent) → Approved → Paid        │
│  Month 1: Recurring job → Reward #2 created → Approved → Paid              │
│  Month 2: Recurring job → Reward #3 created → Approved → Paid              │
│  ...                                                                        │
│  Month 12: Recurring job → Final reward created (if recurring_months=12)   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Bull Jobs

```
process-payout              Process single payout (with provider)
retry-failed-payouts        Retry failed payouts
scheduled-payouts           Run scheduled payout batch
process-recurring-rewards   Monthly recurring reward generation 🆕
check-subscription-status   Verify subscriptions for recurring 🆕
```

---

## Service 6: Analytics Service

**Domain:** Reporting, Dashboards

### Responsibilities
- Ingest events from all services
- Store time-series data in ClickHouse
- Dashboard metrics & KPIs
- Pre-built reports
- Custom queries
- Data export (CSV, Excel)
- Scheduled reports
- Orchestrates AI Service for insights

### Database: `analytics-ch` (ClickHouse)

```sql
-- Raw events (all events land here)
CREATE TABLE events (
    tenant_id UUID,
    event_type LowCardinality(String),
    event_id UUID,
    campaign_id UUID,
    referrer_id UUID,
    referral_id UUID,
    timestamp DateTime64(3),
    properties String, -- JSON
    
    -- For partitioning and sorting
    date Date MATERIALIZED toDate(timestamp)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (tenant_id, event_type, date, timestamp)
TTL date + INTERVAL 2 YEAR;

-- Daily aggregates (materialized view)
CREATE MATERIALIZED VIEW daily_campaign_stats
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (tenant_id, campaign_id, date)
AS SELECT
    tenant_id,
    campaign_id,
    toDate(timestamp) as date,
    countIf(event_type = 'click') as clicks,
    countIf(event_type = 'signup') as signups,
    countIf(event_type = 'conversion') as conversions,
    uniqIf(referrer_id, event_type = 'click') as unique_referrers,
    sumIf(toDecimal64(JSONExtractFloat(properties, 'value'), 2), 
          event_type = 'conversion') as revenue
FROM events
GROUP BY tenant_id, campaign_id, date;

-- Referrer leaderboard (materialized)
CREATE MATERIALIZED VIEW referrer_stats
ENGINE = SummingMergeTree()
ORDER BY (tenant_id, campaign_id, referrer_id)
AS SELECT
    tenant_id,
    campaign_id,
    referrer_id,
    countIf(event_type = 'click') as total_clicks,
    countIf(event_type = 'signup') as total_signups,
    countIf(event_type = 'conversion') as total_conversions,
    sumIf(toDecimal64(JSONExtractFloat(properties, 'value'), 2),
          event_type = 'conversion') as total_revenue
FROM events
GROUP BY tenant_id, campaign_id, referrer_id;

-- Channel performance
CREATE MATERIALIZED VIEW channel_stats
ENGINE = SummingMergeTree()
ORDER BY (tenant_id, campaign_id, channel, date)
AS SELECT
    tenant_id,
    campaign_id,
    JSONExtractString(properties, 'channel') as channel,
    toDate(timestamp) as date,
    count() as shares,
    countIf(event_type = 'click') as clicks,
    countIf(event_type = 'signup') as signups
FROM events
WHERE event_type IN ('share', 'click', 'signup')
GROUP BY tenant_id, campaign_id, channel, date;
```

### PostgreSQL (for scheduled reports)

```
ScheduledReport
├── id
├── tenant_id
├── name
├── type (campaign_summary | referrer_performance | payout_summary)
├── filters (JSONB)
├── schedule (cron expression)
├── recipients[] (emails)
├── format (csv | xlsx | pdf)
├── last_sent_at
├── next_run_at
└── is_active
```

### API Endpoints

```
# Dashboard
GET    /analytics/dashboard                 Overview metrics
GET    /analytics/dashboard/realtime        Live stats (last hour)

# Campaign Analytics
GET    /analytics/campaigns/:id             Campaign metrics
GET    /analytics/campaigns/:id/funnel      Conversion funnel
GET    /analytics/campaigns/:id/channels    Channel breakdown
GET    /analytics/campaigns/:id/trends      Time-series trends

# Referrer Analytics
GET    /analytics/referrers/:id             Referrer metrics
GET    /analytics/leaderboard               Top referrers
GET    /analytics/referrers/cohort          Cohort analysis

# Reports
GET    /analytics/reports                   List available reports
GET    /analytics/reports/:type             Get pre-built report
POST   /analytics/reports/custom            Run custom query
POST   /analytics/export                    Export data (CSV/XLSX)

# AI Insights (proxies to AI Service)
GET    /analytics/insights                  Get insights → calls AI Service
POST   /analytics/insights/generate         Trigger generation → calls AI Service
POST   /analytics/insights/:id/implement    Implement → calls AI Service

# Scheduled Reports
POST   /analytics/scheduled-reports         Create scheduled report
GET    /analytics/scheduled-reports         List scheduled reports
PUT    /analytics/scheduled-reports/:id     Update schedule
DELETE /analytics/scheduled-reports/:id     Delete schedule

# Internal
POST   /internal/ingest                     Batch event ingestion
```

### Events Consumed (from SQS)

```
All events from all services for ingestion:
- tracker.* 
- referral.*
- reward.*
- payout.*
- campaign.*
```

---

## Service 7: AI Service

**Domain:** AI Agents, Content Generation, Insights

### Responsibilities
- Centralized AI/LLM orchestration (LangChain.js)
- Multiple specialized agents
- Conversation management
- Content generation (campaigns, emails, landing pages, widgets)
- Analytics insights generation
- URL/product analysis
- Model management & switching
- Prompt versioning
- Token usage tracking & billing

### Why Separate Service?
- **Centralized model config** - Easy to switch providers (OpenAI, Anthropic, local)
- **Independent scaling** - AI workloads scale differently
- **Prompt management** - Version and A/B test prompts in one place
- **Cost tracking** - Monitor token usage per tenant
- **Agent reusability** - Same agents used by multiple services

### Database: `ai-db` (PostgreSQL)

```
Conversation
├── id (UUID)
├── tenant_id
├── user_id
├── agent_type (campaign_builder | content_generator | insights | url_analyzer)
├── context (JSONB)
│   ├── campaign_id (if linked)
│   ├── source_url
│   ├── extracted_data
│   └── custom_context
├── messages (JSONB array)
│   [{
│     role: "user" | "assistant" | "system",
│     content: "...",
│     timestamp: "...",
│     tokens_used: 150
│   }]
├── status (active | completed | abandoned | error)
├── total_tokens_used
├── created_at
└── updated_at

Generation
├── id (UUID)
├── tenant_id
├── conversation_id (nullable)
├── agent_type
├── generation_type (campaign_template | email | landing_page | widget_copy | insight)
├── input (JSONB) -- what was provided
├── output (JSONB) -- what was generated
├── prompt_version
├── model_used (gpt-4o | claude-3-5-sonnet | etc.)
├── tokens_input
├── tokens_output
├── latency_ms
├── was_selected (boolean) -- if user chose this option
├── feedback (JSONB) -- thumbs up/down, edits made
├── created_at

Insight
├── id (UUID)
├── tenant_id
├── campaign_id
├── type (good_news | watch_out | opportunity)
├── category (performance | fraud | optimization | growth)
├── title
├── description
├── data_points (JSONB)
│   ├── metric_name
│   ├── current_value
│   ├── previous_value
│   ├── change_percentage
│   └── benchmark_value
├── suggested_action
├── action_type (one_click | manual | informational)
├── action_payload (JSONB) -- for one-click implement
├── priority (high | medium | low)
├── confidence_score (0-1)
├── is_read
├── is_dismissed
├── implemented_at
├── generated_at
├── expires_at
└── created_at

PromptTemplate
├── id
├── agent_type
├── name
├── version
├── system_prompt
├── user_prompt_template
├── variables[] -- available placeholders
├── model_config (JSONB)
│   ├── model
│   ├── temperature
│   ├── max_tokens
│   └── top_p
├── is_active
├── a_b_variant (A | B | null)
├── created_at
└── updated_at

AgentTool
├── id
├── agent_type
├── name
├── description
├── tool_type (web_scraper | api_call | calculator | search)
├── config (JSONB)
├── is_active
└── created_at

UsageLog
├── id
├── tenant_id
├── user_id
├── agent_type
├── generation_id
├── model
├── tokens_input
├── tokens_output
├── estimated_cost_usd
├── created_at
```

### Agents (LangChain.js)

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI SERVICE                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Agent Orchestrator                      │    │
│  │  • Conversation management                                │    │
│  │  • Context injection                                      │    │
│  │  • Tool execution                                         │    │
│  │  • Response streaming                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│           │           │           │           │                  │
│  ┌────────▼──┐ ┌──────▼────┐ ┌────▼─────┐ ┌───▼────────┐       │
│  │    URL    │ │  Campaign │ │ Content  │ │  Insights  │       │
│  │ Analyzer  │ │  Builder  │ │Generator │ │   Agent    │       │
│  └───────────┘ └───────────┘ └──────────┘ └────────────┘       │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│  │   Email   │ │  Report   │ │   Fraud   │ │  Reward   │       │
│  │   Agent   │ │ Summarizer│ │   Agent   │ │   Agent   │  🆕   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘       │
│  ┌───────────┐                                                  │
│  │ Analytics │  🆕                                              │
│  │   Agent   │                                                  │
│  └───────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Agent 1: URL Analyzer**
```
Purpose: Extract product information from website
Input: URL
Tools: Web scraper, content extractor, screenshot
Output: {
  product_name,
  product_type (saas | api | tool | platform),
  pricing_model (freemium | paid | usage_based | enterprise),
  target_audience,
  key_features[],
  brand_attributes: { colors[], tone, industry },
  competitors_mentioned[]
}
```

**Agent 2: Campaign Builder**
```
Purpose: Conversational campaign creation
Input: User messages, URL analysis context
Tools: Template generator, rule builder, reward calculator
Output: {
  campaign_config,
  widget_config,
  landing_page_config,
  email_templates[],
  reward_rules[]
}
Mode: Conversational (multi-turn) or One-shot (generate 3 templates)
```

**Agent 3: Content Generator**
```
Purpose: Generate marketing copy
Input: Context (campaign, brand), content_type
Output: Generated content based on type:
  - email: { subject, html_content, text_content }
  - landing_page: { headline, subheadline, benefits[], cta }
  - widget: { headline, description, cta, share_message }
  - social: { twitter, linkedin, whatsapp }
```

**Agent 4: Insights Agent**
```
Purpose: Analyze metrics and generate insights
Input: Analytics data from ClickHouse
Tools: Trend analyzer, anomaly detector, benchmark comparator
Output: {
  insights[]: {
    type, title, description, 
    data_points, suggested_action,
    action_payload (for one-click)
  }
}
Scheduled: Daily insight generation per tenant/campaign
```

**Agent 5: Email Agent**
```
Purpose: Generate personalized emails
Input: Template type, recipient context, campaign context
Output: Personalized email content
Use cases: Weekly digests, re-engagement, milestone celebrations
```

**Agent 6: Report Summarizer**
```
Purpose: Generate natural language report summaries
Input: Report data (metrics, tables)
Output: Human-readable summary paragraph
```

**Agent 7: Fraud Agent** 🆕 (MVP)
```
Purpose: Detect fraud patterns and score risk
Input: Referral data, click data, conversion data
Tools: Pattern matcher, velocity checker, geo analyzer
Output: {
  risk_score (0-100),
  risk_level (low | medium | high),
  flags[]: {
    type (same_ip | velocity | self_referral | geo_anomaly | bot),
    description,
    evidence
  },
  recommendation (approve | review | reject),
  confidence (0-1)
}
Triggers:
  - Real-time: On signup event (quick checks)
  - Batch: On reward creation (full analysis)
```

**Agent 8: Reward Agent** 🆕 (MVP)
```
Purpose: Intelligent reward approval and payout optimization
Input: Reward data, referrer history, fraud agent output
Tools: Risk evaluator, threshold checker, pattern analyzer
Output: {
  decision (auto_approve | escalate | auto_reject),
  confidence (0-1),
  reason: string,
  factors[]: {
    factor (referrer_history | amount | fraud_score | velocity),
    impact (positive | negative),
    weight
  },
  suggestions?: {
    payout_method: "Wise cheaper for EU",
    tax_alert: "Approaching €600 threshold"
  }
}
Integration:
  - Consumes: reward.created event
  - Publishes: reward.auto_approved or reward.escalated
```

**Agent 9: Analytics Agent** 🆕 (V1.2)
```
Purpose: Natural language queries on analytics data
Input: User question in plain English
Tools: SQL generator, ClickHouse executor, visualization selector
Output: {
  interpretation: "You're asking about conversion trends",
  query: "SELECT ... FROM ...", 
  data: [...],
  visualization: {
    type (line | bar | pie | funnel | map),
    config: {...}
  },
  narrative: "Conversions increased 15% this week because..."
}
Guardrails:
  - Tenant ID always enforced in queries
  - Query cost estimation and timeout
  - No raw PII in responses
```

### API Endpoints

```
# Conversations
POST   /ai/conversations                   Start new conversation
GET    /ai/conversations/:id               Get conversation
POST   /ai/conversations/:id/message       Send message (streaming response)
DELETE /ai/conversations/:id               End/abandon conversation

# URL Analysis
POST   /ai/analyze-url                     Analyze product URL
GET    /ai/analysis/:id                    Get analysis result

# Campaign Generation
POST   /ai/generate/campaign               Generate campaign templates (3 options)
POST   /ai/generate/campaign/refine        Refine selected template

# Content Generation
POST   /ai/generate/email                  Generate email content
POST   /ai/generate/landing-page           Generate landing page content
POST   /ai/generate/widget                 Generate widget copy
POST   /ai/generate/social                 Generate social share messages

# Fraud Detection 🆕 (MVP)
POST   /ai/fraud/analyze                   Analyze referral for fraud
POST   /ai/fraud/batch                     Batch fraud analysis
GET    /ai/fraud/patterns/:tenantId        Get detected patterns

# Reward Intelligence 🆕 (MVP)
POST   /ai/reward/evaluate                 Evaluate reward for approval
GET    /ai/reward/recommendations/:referrerId  Get payout recommendations

# Analytics Agent 🆕 (V1.2)
POST   /ai/analytics/query                 Natural language query
GET    /ai/analytics/query/:id             Get query result

# Insights
GET    /ai/insights                        List insights for tenant
GET    /ai/insights/campaign/:id           Insights for campaign
POST   /ai/insights/generate               Trigger insight generation
POST   /ai/insights/:id/dismiss            Dismiss insight
POST   /ai/insights/:id/implement          Execute one-click action
GET    /ai/insights/:id/action-preview     Preview what action will do

# Report Summaries
POST   /ai/summarize/report                Summarize report data
POST   /ai/summarize/weekly                Generate weekly digest content

# Admin/Management
GET    /ai/prompts                         List prompt templates
PUT    /ai/prompts/:id                     Update prompt template
GET    /ai/usage                           Token usage stats
GET    /ai/usage/tenant/:id                Usage by tenant (for billing)

# Internal (service-to-service)
POST   /internal/generate                  Generic generation endpoint
POST   /internal/insights/scheduled        Scheduled insight generation
POST   /internal/fraud/check               Quick fraud check (from Tracker)
POST   /internal/reward/decide             Reward approval decision
```

### Events Published

```
ai.conversation.started
ai.conversation.completed
ai.generation.completed
ai.insight.generated
ai.insight.implemented
ai.fraud.detected 🆕
ai.reward.auto_approved 🆕
ai.reward.escalated 🆕
ai.reward.auto_rejected 🆕
```

### Events Consumed

```
analytics.report.ready → Trigger report summarization
campaign.created → Generate optimization suggestions
reward.created → Evaluate for auto-approval (Reward Agent) 🆕
tracker.signup.received → Quick fraud check (Fraud Agent) 🆕
(scheduled) → Daily insight generation
```

### Bull Jobs

```
generate-insights           Process insight generation for tenant
weekly-digest               Generate weekly digest content
batch-url-analysis          Process multiple URLs
cleanup-old-conversations   Archive old conversations
```

### Model Configuration

```typescript
// Configurable per agent
const modelConfig = {
  urlAnalyzer: {
    model: 'gpt-4o',
    temperature: 0.3,
    maxTokens: 2000
  },
  campaignBuilder: {
    model: 'claude-3-5-sonnet',
    temperature: 0.7,
    maxTokens: 4000
  },
  contentGenerator: {
    model: 'gpt-4o-mini', // faster, cheaper for content
    temperature: 0.8,
    maxTokens: 1500
  },
  insightsAgent: {
    model: 'gpt-4o',
    temperature: 0.2, // more deterministic
    maxTokens: 2000
  }
};
```

### Streaming Support

```
All generation endpoints support streaming via SSE:
- POST /ai/conversations/:id/message?stream=true
- POST /ai/generate/*?stream=true

Response: Server-Sent Events with partial content
```

---

## Service 8: Integration Service

**Domain:** Webhooks, Third-Party Integrations, Emails, Notifications

### Responsibilities
- Outgoing webhook management & delivery
- Third-party integrations (Stripe, HubSpot, Zapier)
- Inbound webhook processing (payment providers)
- Email sending (transactional & marketing)
- In-app notifications
- Slack/Discord notifications

### Database: `integration-db` (PostgreSQL)

```
Integration
├── id
├── tenant_id
├── type (stripe | paddle | hubspot | salesforce | zapier | segment)
├── name (user-defined)
├── status (active | inactive | error | pending_setup)
├── config (encrypted JSONB)
│   Stripe: { webhook_secret, live_mode }
│   HubSpot: { portal_id, sync_contacts }
├── credentials (encrypted JSONB)
│   API keys, tokens, etc.
├── sync_config (JSONB)
│   ├── sync_referrals (boolean)
│   ├── sync_conversions (boolean)
│   └── field_mapping {}
├── last_sync_at
├── last_error
├── created_at
└── updated_at

WebhookEndpoint
├── id
├── tenant_id
├── url
├── secret (for signature verification)
├── events[] (subscribed events)
├── status (active | inactive)
├── headers (JSONB) -- custom headers
├── created_at
└── updated_at

WebhookDelivery
├── id
├── endpoint_id → WebhookEndpoint
├── event_type
├── event_id
├── payload (JSONB)
├── status (pending | delivered | failed)
├── attempts
├── last_attempt_at
├── response_status
├── response_body (truncated)
├── next_retry_at
├── created_at

EmailSend
├── id
├── tenant_id
├── template_type
├── recipient_email
├── recipient_name
├── subject
├── status (queued | sent | delivered | bounced | opened | clicked)
├── provider (ses | sendgrid)
├── provider_id
├── metadata (JSONB)
│   ├── referrer_id
│   ├── campaign_id
│   └── merge_data
├── opened_at
├── clicked_at
├── bounced_at
├── sent_at
└── created_at

NotificationPreference
├── id
├── tenant_id
├── referrer_id
├── channel_preferences (JSONB)
│   ├── email: { enabled, types[] }
│   ├── in_app: { enabled, types[] }
│   └── push: { enabled, types[] }
└── updated_at

SlackIntegration
├── id
├── tenant_id
├── workspace_id
├── channel_id
├── channel_name
├── webhook_url (encrypted)
├── notifications (JSONB) -- which events to send
├── is_active
└── created_at
```

### API Endpoints

```
# Integrations
POST   /integrations                   Create integration
GET    /integrations                   List integrations
GET    /integrations/:id               Get integration
PUT    /integrations/:id               Update integration
DELETE /integrations/:id               Delete integration
POST   /integrations/:id/test          Test integration
POST   /integrations/:id/sync          Trigger manual sync

# Webhooks (outgoing)
POST   /webhooks                       Create webhook endpoint
GET    /webhooks                       List webhooks
PUT    /webhooks/:id                   Update webhook
DELETE /webhooks/:id                   Delete webhook
GET    /webhooks/:id/deliveries        List deliveries
POST   /webhooks/:id/test              Send test webhook
POST   /deliveries/:id/retry           Retry failed delivery

# Webhooks (incoming)
POST   /hooks/stripe/:tenantId         Stripe webhook receiver
POST   /hooks/paddle/:tenantId         Paddle webhook receiver
POST   /hooks/custom/:tenantId         Generic webhook receiver

# Email
POST   /email/send                     Send transactional email
GET    /email/sends                    List email sends
GET    /email/sends/:id                Get email status

# Notifications
GET    /notifications/preferences/:referrerId  Get preferences
PUT    /notifications/preferences/:referrerId  Update preferences
POST   /notifications/in-app           Send in-app notification

# Slack
POST   /slack/connect                  OAuth connect
GET    /slack/channels                 List channels
PUT    /slack/:id                      Update Slack config
POST   /slack/:id/test                 Send test message

# Internal
POST   /internal/send-notification     Send notification (from other services)
POST   /internal/dispatch-webhooks     Dispatch webhooks for event
```

### Events Consumed

```
All events that should trigger notifications/webhooks:
- referral.attributed → Notify referrer
- referral.converted → Notify referrer
- reward.approved → Notify referrer  
- payout.completed → Notify referrer
- campaign.activated → Dispatch webhooks

Weekly digest trigger from Analytics Service
```

### Bull Jobs

```
send-email              Send single email via SES/SendGrid
send-webhook            Deliver single webhook
retry-webhooks          Retry failed webhooks (exponential backoff)
sync-integration        Sync data with third-party (HubSpot, etc.)
send-slack              Send Slack notification
```

### Webhook Delivery Logic

```
Retry schedule: 1min, 5min, 30min, 2hr, 24hr (5 attempts)
Signature: HMAC-SHA256 of payload with endpoint secret
Headers: X-Webhook-Signature, X-Webhook-Timestamp, X-Event-Type
```

---

## Inter-Service Communication

### Synchronous (HTTP via internal ALB)

| From | To | Purpose |
|------|-----|---------|
| Tracker | Campaign | Validate campaign is active |
| Tracker | Referral | Get attribution data |
| Referral | Campaign | Get reward rules |
| Referral | Reward | Trigger reward calculation |
| Reward | Referral | Get referral details |
| Campaign | AI | Generate campaigns, content |
| Campaign | Analytics | Get quick stats |
| Analytics | AI | Generate insights, summaries |
| Integration | AI | Generate weekly digest content |
| All | Tenant | Validate tenant, get settings |

### Asynchronous (SNS → SQS)

**SNS Topics:**
```
referral-platform-events (single topic, filtered by event type)
```

**SQS Queues:**
```
analytics-events-queue          ← All events
integration-events-queue        ← Events for webhooks/notifications
reward-calculation-queue        ← Conversion events for reward calc
ai-generation-queue             ← Scheduled insight/digest generation
```

**Event Schema:**
```json
{
  "eventId": "uuid",
  "eventType": "referral.converted",
  "tenantId": "uuid",
  "timestamp": "2024-12-01T10:00:00Z",
  "data": {
    "referralId": "uuid",
    "referrerId": "uuid",
    "campaignId": "uuid",
    "conversionValue": 99.00,
    "currency": "EUR"
  },
  "metadata": {
    "source": "tracker-service",
    "version": "1.0"
  }
}
```

---

## Data Flow Examples

### Flow 1: Click → Signup → Conversion → Reward → Payout

```
1. Visitor clicks link
   Tracker → store ClickEvent → publish tracker.click.received

2. Visitor signs up  
   Customer backend → POST /t/signup
   Tracker → store SignupEvent → publish tracker.signup.received
   Referral (consumes) → create Referral, attribute → publish referral.attributed
   Integration (consumes) → send notification email, dispatch webhooks

3. Visitor converts (pays)
   Customer backend → POST /t/conversion
   Tracker → store ConversionEvent → publish tracker.conversion.received
   Referral (consumes) → update Referral status → publish referral.converted
   Reward (consumes) → calculate reward, create pending → publish reward.created
   Integration (consumes) → notify referrer, dispatch webhooks

4. Admin approves reward
   Admin → POST /rewards/:id/approve
   Reward → update status → publish reward.approved
   Integration (consumes) → notify referrer

5. Scheduled payout runs
   Reward (Bull job) → process payouts
   Reward → call PayPal API → update status → publish payout.completed
   Integration (consumes) → notify referrer, dispatch webhooks
```

### Flow 2: AI Campaign Creation

```
1. User starts AI builder
   Dashboard → POST /campaigns/ai/analyze-url {url: "https://acme.io"}
   Campaign → calls AI Service POST /ai/analyze-url
   AI Service → URLAnalyzer agent scrapes URL, extracts context
   AI Service → returns analysis to Campaign → returns to Dashboard

2. AI conversation
   Dashboard → POST /campaigns/ai/builder/message {message: "..."}
   Campaign → calls AI Service POST /ai/conversations/:id/message
   AI Service → CampaignBuilder agent processes, streams response
   AI Service → returns response to Campaign → streams to Dashboard

3. Generate templates
   AI Service → CampaignBuilder generates 3 complete campaign configs
   Return to Campaign Service → return to Dashboard for selection

4. User selects template
   Dashboard → POST /campaigns/ai/builder/select {templateIndex: 1}
   Campaign → creates Campaign, WidgetConfig, LandingPage, EmailTemplates

5. User activates
   Dashboard → POST /campaigns/:id/activate
   Campaign → Temporal workflow starts → publish campaign.activated
```

### Flow 3: AI Insights Generation

```
1. Scheduled job triggers (daily)
   AI Service (Bull job) → for each active tenant/campaign

2. Fetch analytics data
   AI Service → calls Analytics GET /analytics/campaigns/:id
   Analytics → queries ClickHouse, returns metrics

3. Generate insights
   AI Service → InsightsAgent analyzes:
   - Trend detection (up/down vs previous period)
   - Anomaly detection (unusual spikes/drops)
   - Benchmark comparison (vs industry average)
   - Opportunity identification (underperforming areas)

4. Store insights
   AI Service → stores Insight records in ai-db
   AI Service → publishes ai.insight.generated

5. User views insights
   Dashboard → GET /analytics/insights
   Analytics → calls AI Service GET /ai/insights
   AI Service → returns insights list

6. User implements one-click action
   Dashboard → POST /analytics/insights/:id/implement
   Analytics → calls AI Service POST /ai/insights/:id/implement
   AI Service → executes action (e.g., calls Campaign to update config)
   AI Service → marks insight as implemented
```

### Flow 4: Payment Enforcement 🆕

```
1. Payment fails
   Stripe webhook → POST /webhooks/stripe (invoice.payment_failed)
   Tenant Service → updates payment_status = 'past_due'
   Tenant Service → publishes payment.failed
   Integration Service → sends payment failed email

2. Daily job checks status
   Tenant Service (Bull cron job, 9 AM daily)
   
3. Day 7: Restriction
   Job → finds past_due > 7 days
   Tenant Service → updates payment_status = 'restricted'
   Tenant Service → publishes tenant.restricted
   Integration Service → sends restriction email
   
4. Day 21: Locking
   Job → finds restricted > 14 days
   Tenant Service → updates payment_status = 'locked'
   Tenant Service → publishes tenant.locked
   Campaign Service → pauses all campaigns for tenant
   Integration Service → invalidates CDN cache (widgets, pages)
   Integration Service → sends lock email

5. Payment succeeds
   Stripe webhook → POST /webhooks/stripe (invoice.paid)
   Tenant Service → updates payment_status = 'active'
   Tenant Service → clears all payment_failed timestamps
   Tenant Service → publishes tenant.restored
   Integration Service → sends restoration email
   Note: Campaigns remain paused, user must reactivate manually
```

### Flow 5: AI Fraud Detection & Reward Approval 🆕

```
1. Signup event received
   Tracker Service → publishes tracker.signup.received
   AI Service (Fraud Agent) → quick fraud check
   - Same IP check
   - Velocity check
   - Self-referral check

2. Referral attributed
   Referral Service → creates Referral record
   Referral Service → publishes referral.attributed

3. Conversion event received
   Tracker Service → publishes tracker.conversion.received
   Referral Service → updates referral status
   Referral Service → publishes referral.converted

4. Reward created
   Reward Service → calculates reward via json-rules-engine
   Reward Service → creates Reward (status: pending)
   Reward Service → publishes reward.created

5. AI evaluates reward
   AI Service (Reward Agent) consumes reward.created
   AI Service → calls Fraud Agent for full analysis
   Fraud Agent → returns risk_score, flags
   Reward Agent → evaluates:
   - Fraud score
   - Referrer history
   - Amount vs thresholds
   - Pattern analysis

6a. Auto-approve (low risk)
   If confidence > 95% and risk_score < 20:
   AI Service → calls Reward Service POST /internal/rewards/:id/approve
   Reward Service → updates status = 'approved'
   AI Service → publishes ai.reward.auto_approved

6b. Escalate (medium risk)
   If risk_score 20-70 or confidence < 95%:
   AI Service → publishes ai.reward.escalated
   Reward Service → adds to manual review queue
   Integration Service → notifies admin

6c. Auto-reject (high risk)
   If risk_score > 70 and confidence > 90%:
   AI Service → calls Reward Service POST /internal/rewards/:id/reject
   Reward Service → updates status = 'rejected'
   AI Service → publishes ai.reward.auto_rejected
   Integration Service → notifies admin with reason

7. Manual review (if escalated)
   Admin → reviews in dashboard
   Admin → approves or rejects
   Reward Service → updates status
   Reward Service → publishes reward.approved or reward.rejected
```

### Flow 6: Account Deletion (GDPR) 🆕

```
1. Owner requests deletion
   Dashboard → POST /tenants/:id/delete
   Tenant Service → verifies password via Ory
   Tenant Service → sets deletion_scheduled_at (30 days)
   Tenant Service → cancels Stripe subscription
   Tenant Service → publishes tenant.deletion_scheduled
   Campaign Service → pauses all campaigns
   Integration Service → sends confirmation email

2. Grace period (30 days)
   User can cancel deletion anytime
   Dashboard → POST /tenants/:id/cancel-deletion
   Reminder emails at Day 7, 21, 29

3. Execute deletion (Day 30)
   Tenant Service (Bull delayed job) → executes
   
   For each service (via events):
   - Campaign Service: delete campaigns, widgets, pages, templates
   - Referral Service: delete referrers, links, referrals
   - Reward Service: delete rewards, balances, payouts
   - Tracker Service: delete events for tenant
   - Analytics Service: delete from ClickHouse
   - AI Service: delete conversations, insights
   - Integration Service: delete webhooks, integrations
   - S3: delete tenant media folder
   
   Tenant Service:
   - Archive audit logs to S3
   - Delete team members
   - Delete API keys
   - Soft delete tenant (keep record for audit)
   
   Integration Service → sends final confirmation email
```

---

## Complete Data Flows 🆕

### Flow 7: Complete Referral Journey (Click → Payout)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    COMPLETE REFERRAL FLOW                                                    │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                              │
│  STEP 1: REFERRER JOINS PROGRAM                                                                             │
│  ────────────────────────────────                                                                           │
│  User → SDK Widget → "Join Referral Program"                                                                │
│  SDK → POST /referrers {email, name, campaign_id}                                                           │
│  Referral Service → Create Referrer, generate unique code/link                                              │
│  → Returns: referral link, code, widget data                                                                │
│  → Publishes: referrer.created                                                                              │
│                                                                                                              │
│  STEP 2: REFERRER SHARES                                                                                    │
│  ───────────────────────                                                                                    │
│  Referrer → Copy link / Share button                                                                        │
│  SDK → POST /t/event {type: "share", channel: "linkedin", referrer_id}                                      │
│  Tracker → Store share event                                                                                │
│  → Publishes: tracker.share.received                                                                        │
│  Analytics → Increment share count                                                                          │
│                                                                                                              │
│  STEP 3: CLICK TRACKED                                                                                      │
│  ───────────────────────                                                                                    │
│  Visitor → Clicks referral link (https://r.app.io/abc123)                                                   │
│  Tracker Service GET /t/c/abc123:                                                                           │
│  ├── Lookup link → get campaign_id, referrer_id, destination_url                                            │
│  ├── Check tenant payment_status (must not be locked)                                                       │
│  ├── Generate visitor_id (UUID)                                                                             │
│  ├── Create ClickEvent record                                                                               │
│  ├── Set first-party cookie (via Set-Cookie header or SDK)                                                  │
│  │   └── Cookie: _ref_attr = {visitor_id, first_click_id, first_click_at, referrer_id}                     │
│  ├── Extract: IP (hash), User-Agent, Referer, UTM params                                                    │
│  ├── Geo lookup: Country, City from IP                                                                      │
│  └── 302 Redirect → destination_url with UTM params                                                         │
│  → Publishes: tracker.click.received                                                                        │
│  Analytics → Real-time click counter                                                                        │
│                                                                                                              │
│  STEP 4: SIGNUP TRACKED (Attribution)                                                                       │
│  ──────────────────────────────────                                                                         │
│  Visitor → Signs up on customer's product                                                                   │
│  Customer Backend → POST /t/signup {                                                                        │
│    email: "new@user.com",                                                                                   │
│    external_id: "user_123",                                                                                 │
│    visitor_id: "from_cookie",  // or referral_code                                                          │
│    metadata: {...}                                                                                          │
│  }                                                                                                          │
│  Tracker Service:                                                                                           │
│  ├── Validate API key                                                                                       │
│  ├── Match visitor_id → find TrackerSession with attribution                                                │
│  ├── Apply attribution model (first_touch default):                                                         │
│  │   ├── Find first click for this visitor_id                                                               │
│  │   └── Get referrer_id from first click                                                                   │
│  ├── Create SignupEvent record                                                                              │
│  └── Publish tracker.signup.received                                                                        │
│                                                                                                              │
│  Referral Service (consumes tracker.signup.received):                                                       │
│  ├── Create Referral record (status: signed_up)                                                             │
│  ├── Link to referrer_id from attribution                                                                   │
│  ├── Quick fraud check via AI Fraud Agent:                                                                  │
│  │   ├── Same IP as referrer? → Flag                                                                        │
│  │   ├── Email domain match? → Flag                                                                         │
│  │   └── Velocity check (signups/hour) → Flag                                                               │
│  ├── Store fraud_check results                                                                              │
│  └── Publish referral.created, referral.attributed                                                          │
│                                                                                                              │
│  Integration Service → Send "New Referral" notification to referrer                                         │
│                                                                                                              │
│  STEP 5: CONVERSION TRACKED                                                                                 │
│  ──────────────────────────                                                                                 │
│  Visitor → Subscribes/Purchases                                                                             │
│  Customer Backend (or Stripe Webhook) → POST /t/conversion {                                                │
│    email: "new@user.com",                                                                                   │
│    type: "paid",                                                                                            │
│    value: 99.00,                                                                                            │
│    currency: "EUR",                                                                                         │
│    product_id: "pro_plan",                                                                                  │
│    is_recurring: true,                                                                                      │
│    subscription_interval: "month"                                                                           │
│  }                                                                                                          │
│  Tracker Service:                                                                                           │
│  ├── Match email → find existing SignupEvent/Referral                                                       │
│  ├── Create ConversionEvent record                                                                          │
│  └── Publish tracker.conversion.received                                                                    │
│                                                                                                              │
│  Referral Service (consumes tracker.conversion.received):                                                   │
│  ├── Update Referral (status: converted, conversion_data)                                                   │
│  └── Publish referral.converted                                                                             │
│                                                                                                              │
│  STEP 6: REWARD CALCULATION                                                                                 │
│  ──────────────────────────                                                                                 │
│  Reward Service (consumes referral.converted):                                                              │
│  ├── Load campaign reward rules                                                                             │
│  ├── Load referrer stats (total_referrals, tier)                                                            │
│  ├── Build facts object for rules engine                                                                    │
│  ├── Run json-rules-engine:                                                                                 │
│  │   ├── Base rule: 10% commission = €9.90                                                                  │
│  │   ├── Tier bonus: Silver 1.25x = €12.38                                                                  │
│  │   └── Cap check: below €50 cap                                                                           │
│  ├── Create Reward record (status: pending)                                                                 │
│  │   {                                                                                                      │
│  │     amount: 12.38,                                                                                       │
│  │     currency: "EUR",                                                                                     │
│  │     is_recurring: true,                                                                                  │
│  │     calculation: {rules_applied: [...], bonuses: [...]}                                                  │
│  │   }                                                                                                      │
│  └── Publish reward.created                                                                                 │
│                                                                                                              │
│  STEP 7: AI REWARD APPROVAL                                                                                 │
│  ──────────────────────────                                                                                 │
│  AI Service (consumes reward.created):                                                                      │
│  ├── Fraud Agent: Full risk analysis                                                                        │
│  │   ├── Referral fraud flags from Step 4                                                                   │
│  │   ├── Additional checks: device fingerprint, geo anomaly                                                 │
│  │   └── Returns: risk_score = 15 (low)                                                                     │
│  ├── Reward Agent: Approval decision                                                                        │
│  │   ├── risk_score (15) < 20 → eligible for auto-approve                                                   │
│  │   ├── referrer_history: 10 previous approved rewards                                                     │
│  │   ├── amount (€12.38) within normal range                                                                │
│  │   └── Decision: AUTO_APPROVE (confidence: 96%)                                                           │
│  └── Publish ai.reward.auto_approved                                                                        │
│                                                                                                              │
│  Reward Service (consumes ai.reward.auto_approved):                                                         │
│  ├── Update reward.status = 'approved'                                                                      │
│  ├── Update reward.approved_by = 'ai_agent'                                                                 │
│  ├── Update reward.ai_decision = {...}                                                                      │
│  ├── Credit referrer balance: available += €12.38                                                           │
│  ├── Create BalanceTransaction                                                                              │
│  └── Publish reward.approved, reward.credited                                                               │
│                                                                                                              │
│  Integration Service → Send "Reward Earned" email to referrer                                               │
│                                                                                                              │
│  STEP 8: PAYOUT                                                                                             │
│  ───────────────                                                                                            │
│  Option A: Referrer Requests Payout                                                                         │
│  ├── Referrer → Portal → "Request Payout"                                                                   │
│  ├── POST /portal/me/request-payout {method_id}                                                             │
│  └── Create Payout (status: pending)                                                                        │
│                                                                                                              │
│  Option B: Scheduled Payout                                                                                 │
│  ├── Bull cron job (e.g., every Monday)                                                                     │
│  ├── Find referrers with balance >= threshold                                                               │
│  └── Create Payout for each                                                                                 │
│                                                                                                              │
│  Payout Processing:                                                                                         │
│  ├── Bull job: process-payout                                                                               │
│  ├── Call PayPal/Wise API                                                                                   │
│  ├── On success:                                                                                            │
│  │   ├── Update payout.status = 'completed'                                                                 │
│  │   ├── Update rewards.status = 'paid'                                                                     │
│  │   ├── Debit referrer balance                                                                             │
│  │   └── Publish payout.completed                                                                           │
│  └── On failure:                                                                                            │
│      ├── Update payout.status = 'failed'                                                                    │
│      ├── Schedule retry                                                                                     │
│      └── Publish payout.failed                                                                              │
│                                                                                                              │
│  Integration Service → Send "Payout Sent" email                                                             │
│                                                                                                              │
│  STEP 9: RECURRING REWARD (Monthly)                                                                         │
│  ────────────────────────────────                                                                           │
│  Monthly cron job (1st of month):                                                                           │
│  ├── Find rewards where is_recurring=true AND referral not churned                                          │
│  ├── Verify subscription still active (via Integration Service → Stripe)                                    │
│  ├── Calculate new reward (same % of current MRR)                                                           │
│  ├── Create child Reward (parent_reward_id → original)                                                      │
│  ├── Send through AI approval flow (Step 7)                                                                 │
│  └── Repeat until recurring_months reached or subscription cancelled                                        │
│                                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Flow 8: Attribution Engine Detail

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ATTRIBUTION ENGINE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  FIRST-TOUCH ATTRIBUTION (Default, MVP)                                     │
│  ──────────────────────────────────────                                     │
│                                                                              │
│  Day 1: Click from Referrer A                                               │
│         └── Cookie: {first_click_id: C1, referrer_id: A}                    │
│                                                                              │
│  Day 5: Click from Referrer B                                               │
│         └── Cookie unchanged (first-touch preserved)                        │
│                                                                              │
│  Day 10: Signup                                                             │
│          └── Attribution → Referrer A (first click)                         │
│                                                                              │
│  Day 30: Conversion                                                         │
│          └── Reward → Referrer A                                            │
│                                                                              │
│                                                                              │
│  LAST-TOUCH ATTRIBUTION (V1.1)                                              │
│  ─────────────────────────────                                              │
│                                                                              │
│  Day 1: Click from Referrer A                                               │
│         └── Cookie: {last_click_id: C1, referrer_id: A}                     │
│                                                                              │
│  Day 5: Click from Referrer B                                               │
│         └── Cookie: {last_click_id: C2, referrer_id: B}                     │
│                                                                              │
│  Day 10: Signup                                                             │
│          └── Attribution → Referrer B (last click)                          │
│                                                                              │
│                                                                              │
│  COOKIE STRUCTURE                                                           │
│  ────────────────                                                           │
│  _ref_attr = {                                                              │
│    visitor_id: "uuid",                                                      │
│    first_click_id: "click_uuid",                                            │
│    first_click_at: "2024-01-01T00:00:00Z",                                  │
│    first_referrer_id: "referrer_a_uuid",                                    │
│    last_click_id: "click_uuid",                                             │
│    last_click_at: "2024-01-05T00:00:00Z",                                   │
│    last_referrer_id: "referrer_b_uuid",                                     │
│    click_count: 2                                                           │
│  }                                                                          │
│                                                                              │
│                                                                              │
│  ATTRIBUTION FALLBACKS                                                       │
│  ─────────────────────                                                      │
│  Priority order:                                                            │
│  1. Cookie attribution (visitor_id match)                                   │
│  2. Referral code (user enters code at signup)                              │
│  3. Email match (customer sends email, we have prior referral)              │
│  4. UTM parameter (utm_ref=referrer_code)                                   │
│                                                                              │
│  If no attribution found → organic signup, no reward                        │
│                                                                              │
│                                                                              │
│  COOKIE EXPIRATION                                                          │
│  ─────────────────                                                          │
│  Configurable per campaign: 30, 60, 90 days                                 │
│  After expiry → new click becomes new first-touch                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Flow 9: Pulse-Specific Data Flows

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    REACTIVATION PULSE FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Daily cron job (Campaign Service)                                       │
│     └── Query: users WHERE last_active < NOW() - 30 days                    │
│         AND NOT already_contacted_for_reactivation                          │
│         AND matches campaign targeting                                      │
│                                                                              │
│  2. For each inactive user:                                                 │
│     Campaign → POST /internal/pulse/trigger {                               │
│       pulse_type: "reactivation",                                           │
│       user_id: "...",                                                       │
│       campaign_id: "..."                                                    │
│     }                                                                       │
│                                                                              │
│  3. Integration Service sends reactivation email                            │
│     └── "We miss you! Come back and get 20% off"                           │
│                                                                              │
│  4. User returns and logs in                                                │
│     Customer → POST /t/event {type: "reactivation", user_id}                │
│                                                                              │
│  5. Reward Service creates reactivation reward                              │
│     └── Typically: credit or discount applied                               │
│                                                                              │
│  6. Track campaign success                                                  │
│     └── Analytics: reactivation_rate, revenue_recovered                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    FEEDBACK PULSE FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Trigger: User completes qualifying action                               │
│     └── e.g., 30 days as paid customer, completed onboarding                │
│                                                                              │
│  2. Eligibility check:                                                      │
│     ├── Is user a paid customer? ✓                                          │
│     ├── Has user been asked before? ✗                                       │
│     └── NPS score > 8? (if available) ✓                                     │
│                                                                              │
│  3. Send feedback request                                                   │
│     Integration Service → Email: "Leave us a review on G2!"                │
│     └── Link: g2.com/products/yourapp/reviews with tracking                 │
│                                                                              │
│  4. Verification (depends on pulse_config.verification_method)              │
│                                                                              │
│     If "screenshot":                                                        │
│     ├── User uploads screenshot of review                                   │
│     ├── AI or manual verification                                           │
│     └── On verify → create reward                                           │
│                                                                              │
│     If "api":                                                               │
│     ├── Poll G2/Capterra API daily                                          │
│     ├── Match new reviews by email/name                                     │
│     └── On match → create reward                                            │
│                                                                              │
│     If "manual":                                                            │
│     ├── Admin searches for review on platform                               │
│     ├── Verifies and approves                                               │
│     └── On approve → create reward                                          │
│                                                                              │
│  5. Reward typically: Gift card (Amazon, etc.) via gift card service        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    RENEWAL PULSE FLOW                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Daily cron job checks subscriptions                                     │
│     Query: subscriptions WHERE ends_at BETWEEN NOW() and NOW() + 30 days    │
│     AND NOT auto_renew_enabled                                              │
│     AND NOT renewal_campaign_sent                                           │
│                                                                              │
│  2. For each expiring subscription:                                         │
│     ├── Generate unique discount code                                       │
│     ├── Store code linked to subscription                                   │
│     └── Send via Integration Service                                        │
│                                                                              │
│  3. Reminder schedule:                                                      │
│     ├── Day -30: "Your subscription expires soon"                           │
│     ├── Day -14: "Don't lose your data - renew now"                        │
│     ├── Day -7:  "Last week! Use code RENEW20 for 20% off"                 │
│     └── Day -1:  "Final reminder - expires tomorrow"                        │
│                                                                              │
│  4. User renews                                                             │
│     ├── Stripe webhook: subscription.renewed                                │
│     └── Track success in Analytics                                          │
│                                                                              │
│  5. If renewal used discount code:                                          │
│     └── Track campaign attribution (no cash reward, just retention)        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    SWITCHUP PULSE FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Goal: Acquire customers from competitors                                   │
│                                                                              │
│  Detection Methods:                                                         │
│                                                                              │
│  1. Email domain matching                                                   │
│     ├── User signs up with @competitor.com email                            │
│     └── Flag as potential switchup                                          │
│                                                                              │
│  2. UTM tracking                                                            │
│     ├── Landing page: /switch-from-competitor                               │
│     └── UTM: utm_source=competitor_name                                     │
│                                                                              │
│  3. Self-declaration                                                        │
│     ├── Signup form: "Coming from another tool?"                            │
│     └── User selects competitor from list                                   │
│                                                                              │
│  4. Data import                                                             │
│     ├── User imports data from competitor                                   │
│     └── Detect format/source                                                │
│                                                                              │
│  Reward Flow:                                                               │
│                                                                              │
│  1. Detect switchup during signup                                           │
│  2. Apply extended trial (e.g., 30 days instead of 14)                      │
│  3. If converts to paid:                                                    │
│     ├── Bonus credit applied                                                │
│     └── Track in Analytics: switchup_conversions                            │
│                                                                              │
│  Optional: Proof verification                                               │
│  ├── User provides screenshot of competitor dashboard                       │
│  └── Higher reward tier if verified                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    CROSS-SELL PULSE FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Goal: Upsell existing customers to higher plans or add-ons                 │
│                                                                              │
│  1. Segment identification                                                  │
│     Query users WHERE:                                                      │
│     ├── plan = 'basic'                                                      │
│     ├── usage > 80% of plan limit                                           │
│     ├── customer_for > 60 days                                              │
│     └── NOT contacted in last 30 days                                       │
│                                                                              │
│  2. AI determines best offer                                                │
│     ├── Usage patterns suggest which features they need                     │
│     └── Personalize offer: "You've hit your limit 3 times this month"      │
│                                                                              │
│  3. Send targeted campaign                                                  │
│     ├── In-app banner: "Upgrade to Pro and get unlimited X"                │
│     └── Email with personalized benefits                                    │
│                                                                              │
│  4. User upgrades                                                           │
│     ├── Stripe webhook: subscription.updated                                │
│     └── Attribute to cross-sell campaign                                    │
│                                                                              │
│  5. Reward (if applicable)                                                  │
│     ├── Credit toward next month                                            │
│     └── Feature unlock bonus                                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    EDUCATION PULSE FLOW                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Goal: Drive feature adoption and reduce churn                              │
│                                                                              │
│  1. Define required actions (in campaign config)                            │
│     required_actions: [                                                     │
│       "complete_onboarding",                                                │
│       "create_first_campaign",                                              │
│       "invite_team_member",                                                 │
│       "integrate_payment"                                                   │
│     ]                                                                       │
│     completion_threshold: 75% (3 of 4)                                      │
│                                                                              │
│  2. Track progress                                                          │
│     Customer → POST /t/event {type: "feature_used", feature: "..."}        │
│     └── Update user's progress record                                       │
│                                                                              │
│  3. Nudge incomplete steps                                                  │
│     ├── In-app checklist showing progress                                   │
│     ├── Targeted emails for each missing step                               │
│     └── "2 of 4 complete! Finish setup for bonus credit"                   │
│                                                                              │
│  4. Reward on completion                                                    │
│     If progress >= completion_threshold:                                    │
│     ├── Create reward (credit, badge, feature unlock)                       │
│     └── Celebrate: "You're all set! Here's €10 credit"                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary: 8 Services + 9 AI Agents

| Service | Primary Responsibility | Database | Key Tech |
|---------|----------------------|----------|----------|
| **Tenant** | Accounts, teams, billing, payment enforcement | PostgreSQL | Ory, Stripe |
| **Campaign** | Campaigns, widgets, pages, templates | PostgreSQL | Temporal |
| **Tracker** | High-volume event tracking | PostgreSQL (partitioned) | SSE, CDN |
| **Referral** | Referrers, links, attribution | PostgreSQL | Fraud rules |
| **Reward** | Rewards, balances, payouts | PostgreSQL | json-rules-engine, PayPal/Wise |
| **Analytics** | Reporting, dashboards | ClickHouse | Time-series |
| **AI** | 9 Agents, content gen, insights | PostgreSQL | LangChain.js |
| **Integration** | Webhooks, email, 3rd party | PostgreSQL | Bull, SES |

### AI Agents Summary

| Agent | Priority | Purpose |
|-------|----------|---------|
| URL Analyzer | MVP | Extract product info from website |
| Campaign Builder | MVP | Conversational campaign creation |
| Content Generator | MVP | Landing pages, emails, widgets |
| Insights Agent | V1.1 | Performance insights and anomalies |
| Email Agent | V1.1 | Weekly digests, re-engagement |
| Report Summarizer | V1.2 | Natural language report summaries |
| **Fraud Agent** | **MVP** 🆕 | Risk scoring, pattern detection |
| **Reward Agent** | **MVP** 🆕 | Auto-approval, payout intelligence |
| **Analytics Agent** | V1.2 🆕 | Natural language queries |

---

## Key Flows

| Flow | Description |
|------|-------------|
| **Complete Referral Journey** 🆕 | Click → Attribution → Signup → Conversion → Reward Calculation → AI Approval → Balance → Payout |
| AI Campaign Creation | URL analysis → templates → customization |
| AI Insights Generation | Daily analysis → recommendations |
| **Payment Enforcement** | Failed payment → grace → restrict → lock |
| **AI Fraud & Reward Approval** | Fraud check → risk score → auto-approve/escalate |
| **Account Deletion** | Request → 30-day grace → cross-service deletion |
| **Attribution Engine** 🆕 | Cookie-based first-touch/last-touch with fallbacks |
| **Recurring Rewards** 🆕 | Monthly reward generation for subscriptions |

### Pulse Types

| Pulse | Trigger | Flow |
|-------|---------|------|
| **Referral** | User shares link | Classic referral → conversion → reward |
| **Signup** | Visitor registers | Organic signup incentive |
| **Conversion** | Free user pays | Conversion bonus |
| **Reactivation** | User inactive >X days | Cron → email → return → reward |
| **Renewal** | Subscription expiring | Reminder sequence → renewal discount |
| **Feedback** | Qualifying action | Request → verification → reward |
| **Switchup** | Competitor user signs up | Detect → extended trial → conversion bonus |
| **Cross-Sell** | User at plan limit | Identify → offer → upgrade → credit |
| **Newsletter** | Visitor on site | Subscribe → entry into giveaway |
| **Education** | User hasn't completed setup | Track progress → nudge → completion reward |

---

## Next Steps

1. **API Contracts** - OpenAPI specs for each service
2. **Event Schemas** - JSON Schema for all events  
3. **Data Models** - TypeORM entities with decorators
4. **Infrastructure** - Terraform for AWS resources
5. **CI/CD** - GitHub Actions pipelines
6. **Backlogs** - User stories per service ✅ (Tenant Service done)
7. **Pulse Configuration UI** - Design for each pulse type
