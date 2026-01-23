# 📚 Functional Domain Concepts
## Core Definitions, Actors, Workflows & Rules

**Version:** 1.0  
**Created:** December 2024  
**Purpose:** Define all core concepts before technical implementation

---

# 📋 Table of Contents

1. [Actors](#actors)
2. [Referrer Account Models](#referrer-account-models)
3. [Actor Lifecycle & Evolution](#actor-lifecycle)
4. [Campaign Workflow Types](#campaign-workflow-types)
5. [Referrer Onboarding Flows](#referrer-onboarding-flows)
6. [Metrics by Referrer Type](#metrics-by-referrer-type)
7. [Reward Types](#reward-types)
8. [Reward-Campaign Compatibility Matrix](#compatibility-matrix)
9. [Rules & Checks](#rules-checks)
10. [Portal Features by Referrer Type](#portal-features)
11. [Implementation Priority](#implementation-priority)
12. [Glossary](#glossary)

---

# 1️⃣ Actors

## Overview

An **Actor** is any person or entity that interacts with the referral system.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ACTOR HIERARCHY                                                │
│                                                                 │
│                                                                 │
│  YOUR PLATFORM                        CLIENT'S ECOSYSTEM        │
│  ─────────────────                    ──────────────────        │
│                                                                 │
│  ┌─────────────┐                      ┌─────────────────────┐   │
│  │  Platform   │                      │       Client        │   │
│  │   Admin     │                      │  (Your Customer)    │   │
│  │   (You)     │                      └─────────────────────┘   │
│  └─────────────┘                                │               │
│                                                 │               │
│                                    ┌────────────┴────────────┐  │
│                                    │                         │  │
│                                    ▼                         ▼  │
│                            ┌─────────────┐           ┌───────────────┐
│                            │   Client    │           │   Referrer    │
│                            │   Admin     │           │               │
│                            └─────────────┘           └───────────────┘
│                                                              │        
│                                                              │        
│                                                              ▼        
│                                                      ┌───────────────┐
│                                                      │   Prospect    │
│                                                      │  (Referred)   │
│                                                      └───────────────┘
│                                                              │        
│                                                              ▼        
│                                                      ┌───────────────┐
│                                                      │   Converted   │
│                                                      │    Customer   │
│                                                      └───────────────┘
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Actor Definitions

### 1. Platform Admin (You)

| Attribute | Description |
|-----------|-------------|
| **Definition** | Owner/operator of the referral platform (you) |
| **Role** | Manages the SaaS platform, clients, billing |
| **Access** | Full platform access, all tenants |
| **Actions** | Onboard clients, manage subscriptions, platform settings |

---

### 2. Client

| Attribute | Description |
|-----------|-------------|
| **Definition** | A company that uses your referral platform (your customer) |
| **Also Called** | Customer, Tenant, Account |
| **Role** | Runs referral programs for their own product |
| **Examples** | A SaaS company, an AI tool, a developer tool |
| **Pays** | Subscription fee to your platform |

---

### 3. Client Admin

| Attribute | Description |
|-----------|-------------|
| **Definition** | Team member of the Client who manages their referral program |
| **Role** | Creates campaigns, configures rewards, views analytics |
| **Access** | Their tenant only (isolated from other clients) |
| **Sub-roles** | Admin (full), Editor (limited), Viewer (read-only) |

---

### 4. Referrer

| Attribute | Description |
|-----------|-------------|
| **Definition** | A person who refers others to the Client's product |
| **Also Called** | Advocate, Promoter, Affiliate, Partner, Ambassador |
| **Origin** | Usually an existing customer of the Client |
| **Goal** | Earn rewards by bringing new customers |
| **Has** | Unique referral link, referral code, reward balance |

#### Referrer Sub-Types

| Sub-Type | Description | Typical Campaign |
|----------|-------------|------------------|
| **Customer Referrer** | Existing paying customer who refers friends | User Referral |
| **User Referrer** | Free user (not paying) who refers others | User Referral |
| **Affiliate** | External partner, may not use product | Affiliate Program |
| **Partner** | Business partner, reseller, agency | Partner Program |
| **Employee** | Internal staff member | Employee Referral |
| **Influencer** | Social media presence, content creator | Influencer Program |
| **Ambassador** | Long-term dedicated advocate | Ambassador Program |

---

### 5. Prospect

| Attribute | Description |
|-----------|-------------|
| **Definition** | A person who clicked a referral link but hasn't converted yet |
| **Also Called** | Lead, Referred User, Potential Customer |
| **Status** | Aware of product, considering purchase |
| **Tracked By** | Cookie, email, referral code |
| **May Become** | Converted Customer or Abandoned |

---

### 6. Converted Customer

| Attribute | Description |
|-----------|-------------|
| **Definition** | A Prospect who completed the desired conversion action |
| **Also Called** | Referred Customer, New Customer |
| **Conversion Types** | Signup, Trial Start, Purchase, Subscription |
| **Triggers** | Reward calculation for the Referrer |

---

### 7. Referee (Two-Sided Rewards)

| Attribute | Description |
|-----------|-------------|
| **Definition** | The Converted Customer when they ALSO receive a reward |
| **Context** | Two-sided reward programs only |
| **Example** | "Refer a friend, you both get €20" |
| **Benefit** | Incentive to use the referral link |

---

## Referrer Account Models

### The Key Question: Where Do Referrers Live?

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  TWO DISTINCT REFERRER MODELS                                   │
│                                                                 │
│                                                                 │
│  MODEL A: EMBEDDED (User Referral - MVP)                        │
│  ────────────────────────────────────────                       │
│                                                                 │
│  Referrer is ALREADY a user of Client's product                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                         │    │
│  │   Client's App (myapp.com)                              │    │
│  │   ┌─────────────────────────────────────────────────┐   │    │
│  │   │                                                 │   │    │
│  │   │   User logs in with their existing account      │   │    │
│  │   │   Sees referral widget in sidebar/dashboard     │   │    │
│  │   │   Gets link, shares, tracks in widget           │   │    │
│  │   │                                                 │   │    │
│  │   │   NO separate account needed                    │   │    │
│  │   │   Authenticated via Client's system             │   │    │
│  │   │                                                 │   │    │
│  │   └─────────────────────────────────────────────────┘   │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│                                                                 │
│  MODEL B: PORTAL (Affiliate, Partner, Influencer, Ambassador)  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Referrer may NOT be a user of Client's product                 │
│  Needs dedicated account and portal                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                         │    │
│  │   Referrer Portal (hosted by ReferralAI)                │    │
│  │   ┌─────────────────────────────────────────────────┐   │    │
│  │   │                                                 │   │    │
│  │   │   Referrer creates account OR is invited        │   │    │
│  │   │   Logs into dedicated portal                    │   │    │
│  │   │   Full dashboard: links, stats, payouts         │   │    │
│  │   │   Marketing materials, resources                │   │    │
│  │   │                                                 │   │    │
│  │   │   SEPARATE account on ReferralAI platform       │   │    │
│  │   │   White-labeled: partners.clientapp.com         │   │    │
│  │   │                                                 │   │    │
│  │   └─────────────────────────────────────────────────┘   │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│                                                                 │
│  MODEL C: INTERNAL (Employee Referral)                          │
│  ─────────────────────────────────────                          │
│                                                                 │
│  Referrer is employee of Client company                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                         │    │
│  │   Employee Portal (SSO with company)                    │    │
│  │   ┌─────────────────────────────────────────────────┐   │    │
│  │   │                                                 │   │    │
│  │   │   Employee logs in via company SSO              │   │    │
│  │   │   Access controlled by HR/Admin                 │   │    │
│  │   │   Limited to internal employees only            │   │    │
│  │   │                                                 │   │    │
│  │   └─────────────────────────────────────────────────┘   │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Account Model by Referrer Type

| Referrer Type | Account Model | Account Location | Authentication |
|---------------|---------------|------------------|----------------|
| **Customer Referrer** | Embedded (A) | Client's system | Client's auth |
| **User Referrer** | Embedded (A) | Client's system | Client's auth |
| **Affiliate** | Portal (B) | ReferralAI platform | Email + password |
| **Partner/Reseller** | Portal (B) | ReferralAI platform | Email + password |
| **Influencer** | Portal (B) | ReferralAI platform | Email + password |
| **Ambassador** | Portal (B) | ReferralAI platform | Email + password |
| **Employee** | Internal (C) | Client's SSO | Company SSO |

### Portal Hosting Options

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  PORTAL HOSTING OPTIONS (for Model B)                           │
│                                                                 │
│                                                                 │
│  OPTION 1: REFERRALAI SUBDOMAIN                                 │
│  ───────────────────────────────                                │
│                                                                 │
│  URL: clientname.referralai.com/portal                          │
│  Branding: Client's logo and colors                             │
│  Effort: Zero setup for client                                  │
│  Best for: Small clients, quick start                           │
│                                                                 │
│                                                                 │
│  OPTION 2: CLIENT'S CUSTOM DOMAIN (Recommended)                 │
│  ──────────────────────────────────────────────                 │
│                                                                 │
│  URL: partners.clientapp.com                                    │
│       affiliates.clientapp.com                                  │
│       refer.clientapp.com                                       │
│  Branding: Fully white-labeled                                  │
│  Effort: DNS configuration by client                            │
│  Best for: Professional appearance                              │
│                                                                 │
│                                                                 │
│  OPTION 3: EMBEDDED IFRAME                                      │
│  ─────────────────────────                                      │
│                                                                 │
│  URL: clientapp.com/partners (iframe)                           │
│  Branding: Seamless integration                                 │
│  Effort: Client embeds iframe                                   │
│  Best for: Deep integration                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

# 2️⃣ Actor Lifecycle & Evolution

## The Referrer Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  REFERRER LIFECYCLE                                             │
│                                                                 │
│                                                                 │
│  ┌─────────────┐                                                │
│  │   Visitor   │  Someone visits Client's website               │
│  └──────┬──────┘                                                │
│         │                                                       │
│         │ Signs up (free or paid)                               │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │    User     │  Has an account, may or may not pay            │
│  └──────┬──────┘                                                │
│         │                                                       │
│         │ Makes first purchase / Subscribes                     │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │  Customer   │  Paying customer of the Client                 │
│  └──────┬──────┘                                                │
│         │                                                       │
│         │ Joins referral program (opts in)                      │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │  Referrer   │  Has referral link, can earn rewards           │
│  │  (Inactive) │  Hasn't shared yet                             │
│  └──────┬──────┘                                                │
│         │                                                       │
│         │ Shares referral link                                  │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │  Referrer   │  Has shared, waiting for conversions           │
│  │  (Active)   │                                                │
│  └──────┬──────┘                                                │
│         │                                                       │
│         │ Gets first successful conversion                      │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │  Referrer   │  Has earned rewards                            │
│  │ (Successful)│                                                │
│  └──────┬──────┘                                                │
│         │                                                       │
│         │ Continues referring, reaches milestones               │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │    Top      │  High-value referrer, VIP treatment            │
│  │  Referrer   │                                                │
│  └─────────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Referrer Status States

| Status | Definition | Criteria |
|--------|------------|----------|
| **Inactive** | Joined program, never shared | 0 shares, 0 clicks |
| **Active** | Has shared at least once | 1+ shares or clicks |
| **Engaged** | Regular sharing activity | Activity in last 30 days |
| **Successful** | Has at least one conversion | 1+ conversions |
| **Top Performer** | High conversion volume/value | Top 10% by revenue |
| **Dormant** | Was active, now inactive | No activity 30+ days |
| **Churned** | Left the program or product | Account closed or opted out |

---

## The Prospect Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  PROSPECT LIFECYCLE                                             │
│                                                                 │
│                                                                 │
│  ┌─────────────┐                                                │
│  │  Unknown    │  Never heard of the product                    │
│  │   Person    │                                                │
│  └──────┬──────┘                                                │
│         │                                                       │
│         │ Sees referral link (email, social, etc.)              │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │   Aware     │  Knows about product via referral              │
│  │  Prospect   │  Hasn't clicked yet                            │
│  └──────┬──────┘                                                │
│         │                                                       │
│         │ Clicks referral link                                  │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │  Clicked    │  Visited site, cookie set                      │
│  │  Prospect   │  Referrer attribution recorded                 │
│  └──────┬──────┘                                                │
│         │                                                       │
│         ├─────────────────────────────────────┐                 │
│         │                                     │                 │
│         │ Signs up                            │ Leaves          │
│         ▼                                     ▼                 │
│  ┌─────────────┐                       ┌─────────────┐          │
│  │  Signed Up  │                       │  Abandoned  │          │
│  │  Prospect   │                       │  Prospect   │          │
│  └──────┬──────┘                       └─────────────┘          │
│         │                                                       │
│         ├─────────────────────────────────────┐                 │
│         │                                     │                 │
│         │ Starts trial                        │ No trial        │
│         ▼                                     │                 │
│  ┌─────────────┐                              │                 │
│  │   Trial     │                              │                 │
│  │    User     │                              │                 │
│  └──────┬──────┘                              │                 │
│         │                                     │                 │
│         ├─────────────────────────────────────┤                 │
│         │                                     │                 │
│         │ Makes purchase                      │ Doesn't buy     │
│         ▼                                     ▼                 │
│  ┌─────────────┐                       ┌─────────────┐          │
│  │  Converted  │                       │    Lost     │          │
│  │  Customer   │ ← TRIGGERS REWARD     │  Prospect   │          │
│  └──────┬──────┘                       └─────────────┘          │
│         │                                                       │
│         │ May become a Referrer themselves                      │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │   Future    │  The cycle continues...                        │
│  │  Referrer   │                                                │
│  └─────────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Prospect Status States

| Status | Definition | Attribution Window |
|--------|------------|-------------------|
| **Clicked** | Clicked referral link | Cookie set (90 days default) |
| **Signed Up** | Created account | Attribution active |
| **Trial Started** | Started free trial | Attribution active |
| **Converted** | Made purchase | TRIGGERS REWARD |
| **Abandoned** | Left without action | Cookie may still be valid |
| **Expired** | Attribution window passed | No reward if converts now |

---

## Conversion Events

| Event | Definition | Common Trigger |
|-------|------------|----------------|
| **Signup** | Created an account | Email + password submitted |
| **Trial Start** | Started free trial | Trial activated |
| **First Purchase** | Made first payment | Payment successful |
| **Subscription Start** | Started recurring payment | Subscription activated |
| **Plan Upgrade** | Upgraded to higher tier | Upgrade confirmed |
| **Custom Event** | Client-defined action | API call from client |

---

# 3️⃣ Campaign Workflow Types

## Overview

A **Campaign Workflow Type** defines the structure and rules of a referral program.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  CAMPAIGN WORKFLOW TYPES                                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   MVP CAMPAIGNS                         │    │
│  │                                                         │    │
│  │  • User Referral Program (one-sided or two-sided)       │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   V1.1 CAMPAIGNS                        │    │
│  │                                                         │    │
│  │  • Waitlist / Viral Launch                              │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   V1.2 CAMPAIGNS                        │    │
│  │                                                         │    │
│  │  • Affiliate Program                                    │    │
│  │  • Employee Referral                                    │    │
│  │  • Contest / Sweepstakes                                │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    V2 CAMPAIGNS                         │    │
│  │                                                         │    │
│  │  • Partner / Reseller Program                           │    │
│  │  • Influencer Program                                   │    │
│  │  • Ambassador Program                                   │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3.1 User Referral Program (MVP)

### Definition

Existing users/customers refer new users to the product. The most common and fundamental referral type.

### Variants

| Variant | Referrer Gets | Referee Gets |
|---------|---------------|--------------|
| **One-Sided** | Reward | Nothing |
| **Two-Sided** | Reward | Reward (incentive to use link) |

### Characteristics

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  USER REFERRAL PROGRAM                                          │
│                                                                 │
│  Who Can Refer:     Existing users/customers of the Client      │
│  Who Is Referred:   Anyone (friends, colleagues, network)       │
│  Relationship:      Personal (knows the referee)                │
│  Trust Level:       High (personal recommendation)              │
│  Volume:            Medium (limited by personal network)        │
│  Quality:           High (trusted recommendations)              │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GROWTH TARGET                                                  │
│                                                                 │
│  • Customer acquisition                                         │
│  • Organic growth                                               │
│  • Reducing CAC (Customer Acquisition Cost)                     │
│  • Building word-of-mouth                                       │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  BEST FOR                                                       │
│                                                                 │
│  • B2B SaaS with happy customers                                │
│  • Products with network effects                                │
│  • Products people talk about                                   │
│  • Products solving clear pain points                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  USER REFERRAL WORKFLOW                                         │
│                                                                 │
│                                                                 │
│  1. ENROLLMENT                                                  │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ Customer sees referral widget/page                   │    │
│     │ Customer opts into program                           │    │
│     │ System generates unique referral link & code         │    │
│     │ Customer becomes "Referrer"                          │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                     │
│                           ▼                                     │
│  2. SHARING                                                     │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ Referrer shares link via:                            │    │
│     │ • Email                                              │    │
│     │ • WhatsApp                                           │    │
│     │ • LinkedIn                                           │    │
│     │ • Direct copy/paste                                  │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                     │
│                           ▼                                     │
│  3. CLICK                                                       │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ Prospect clicks referral link                        │    │
│     │ System records click                                 │    │
│     │ System sets attribution cookie (first-party)         │    │
│     │ Prospect becomes "Clicked Prospect"                  │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                     │
│                           ▼                                     │
│  4. CONVERSION                                                  │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ Prospect signs up                                    │    │
│     │ Prospect starts trial (optional)                     │    │
│     │ Prospect makes purchase ← CONVERSION TRIGGER         │    │
│     │ Prospect becomes "Converted Customer"                │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                     │
│                           ▼                                     │
│  5. REWARD                                                      │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ System calculates reward based on rules              │    │
│     │ System credits reward to Referrer balance            │    │
│     │ (Two-sided) System credits reward to Referee         │    │
│     │ System sends notifications                           │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                     │
│                           ▼                                     │
│  6. PAYOUT                                                      │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ Referrer requests payout (or auto-payout)            │    │
│     │ System validates fraud checks                        │    │
│     │ System processes payment (PayPal, Wise, etc.)        │    │
│     │ Referrer receives money                              │    │
│     └──────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Compatible Reward Types

| Reward Type | Compatibility | Notes |
|-------------|---------------|-------|
| Cash (Fixed) | ✅ Excellent | Most common, easy to understand |
| Cash (Percentage) | ✅ Excellent | Aligns reward with value |
| Cash (Recurring) | ✅ Excellent | For subscription products |
| Account Credit | ✅ Excellent | Keeps money in ecosystem |
| Discount Code | ✅ Good | For two-sided rewards |
| Feature Unlock | ✅ Good | For freemium products |
| Gift Card | ⚠️ Moderate | Adds complexity |

### Rules & Checks

| Rule | Description | Default |
|------|-------------|---------|
| **Eligibility** | Who can become a referrer | Paying customers only |
| **Self-Referral** | Can user refer themselves | ❌ Blocked |
| **Duplicate Referral** | Same person referred twice | ❌ First referrer wins |
| **Same Household** | Same IP/device | ⚠️ Flagged for review |
| **Conversion Window** | How long attribution lasts | 90 days |
| **Minimum Purchase** | Required purchase amount | Configurable |
| **Reward Cap** | Maximum reward per referral | Configurable |
| **Total Cap** | Maximum rewards per period | Configurable |
| **Refund Handling** | What happens if refund | Revoke/reduce reward |

---

## 3.2 Waitlist / Viral Launch Campaign (V1.1)

### Definition

Pre-launch campaign where people refer others to move up a waitlist. Creates viral anticipation.

### Characteristics

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  WAITLIST / VIRAL LAUNCH CAMPAIGN                               │
│                                                                 │
│  Who Can Refer:     Anyone who joins waitlist                   │
│  Who Is Referred:   Anyone interested in the product            │
│  Relationship:      Can be personal or public                   │
│  Trust Level:       Medium (interest-based)                     │
│  Volume:            High (viral potential)                      │
│  Quality:           Medium (volume over quality)                │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GROWTH TARGET                                                  │
│                                                                 │
│  • Pre-launch buzz                                              │
│  • Email list building                                          │
│  • Viral growth                                                 │
│  • Market validation                                            │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  BEST FOR                                                       │
│                                                                 │
│  • New product launches                                         │
│  • Feature launches                                             │
│  • Beta access programs                                         │
│  • Limited availability products                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  WAITLIST WORKFLOW                                              │
│                                                                 │
│                                                                 │
│  1. JOIN WAITLIST                                               │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ Visitor submits email to join waitlist               │    │
│     │ System assigns position: #4,532                      │    │
│     │ System generates unique referral link                │    │
│     │ Visitor becomes "Waitlist Member"                    │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                     │
│                           ▼                                     │
│  2. SHARE TO MOVE UP                                            │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ Member sees: "Move up by referring friends"          │    │
│     │ Member shares unique link                            │    │
│     │ Each successful referral = move up X positions       │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                     │
│                           ▼                                     │
│  3. FRIEND JOINS                                                │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ Friend clicks link                                   │    │
│     │ Friend joins waitlist                                │    │
│     │ Original member moves up (e.g., +100 positions)      │    │
│     │ Friend gets their own referral link                  │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                     │
│                           ▼                                     │
│  4. LAUNCH                                                      │
│     ┌──────────────────────────────────────────────────────┐    │
│     │ Product launches                                     │    │
│     │ Access granted by position (top first)               │    │
│     │ Top referrers may get extra perks                    │    │
│     └──────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Compatible Reward Types

| Reward Type | Compatibility | Notes |
|-------------|---------------|-------|
| Position Boost | ✅ Excellent | Core mechanic |
| Early Access | ✅ Excellent | Access before others |
| Exclusive Features | ✅ Excellent | Beta features, premium tier |
| Discount at Launch | ✅ Good | Incentive to convert |
| Cash | ⚠️ Moderate | Less common for waitlists |
| Swag/Merchandise | ✅ Good | For top referrers |

### Rules & Checks

| Rule | Description | Default |
|------|-------------|---------|
| **Position Boost** | Positions gained per referral | Configurable (e.g., +100) |
| **Verified Email** | Require email verification | ✅ Yes |
| **Duplicate Email** | Same email domain patterns | ⚠️ Flagged |
| **Leaderboard** | Show top referrers | ✅ Optional |
| **Milestone Rewards** | Extra perks at thresholds | 5, 10, 25 referrals |

---

## 3.3 Affiliate Program (V1.2)

### Definition

External partners (not necessarily customers) promote the product for commission. Focus on reach over relationship.

### Characteristics

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  AFFILIATE PROGRAM                                              │
│                                                                 │
│  Who Can Refer:     Anyone who applies/is approved              │
│  Who Is Referred:   Their audience (unknown to Client)          │
│  Relationship:      Transactional (less personal)               │
│  Trust Level:       Lower (promotional content)                 │
│  Volume:            High (reach-based)                          │
│  Quality:           Variable (depends on affiliate)             │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GROWTH TARGET                                                  │
│                                                                 │
│  • Scale acquisition                                            │
│  • Reach new audiences                                          │
│  • Performance marketing                                        │
│  • SEO/content backlinks                                        │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  BEST FOR                                                       │
│                                                                 │
│  • Products with clear value proposition                        │
│  • Higher price points (justify commission)                     │
│  • Products with broad appeal                                   │
│  • Established products seeking scale                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Differences from User Referral

| Aspect | User Referral | Affiliate |
|--------|---------------|-----------|
| **Referrer Origin** | Existing customer | External partner |
| **Relationship** | Personal network | Audience/followers |
| **Approval** | Automatic | May require application |
| **Commission** | Usually fixed | Usually percentage |
| **Materials** | Basic link | Marketing assets, banners |
| **Tracking** | Simple | More sophisticated |
| **Compliance** | Lower risk | FTC disclosure required |

### Compatible Reward Types

| Reward Type | Compatibility | Notes |
|-------------|---------------|-------|
| Percentage Commission | ✅ Excellent | Industry standard |
| Recurring Commission | ✅ Excellent | For SaaS subscriptions |
| Fixed Bounty | ✅ Good | For specific actions |
| Tiered Commission | ✅ Excellent | Rewards top performers |
| Cash | ✅ Required | Affiliates expect cash |
| Product Credits | ❌ Poor | Affiliates may not use product |

### Rules & Checks

| Rule | Description | Default |
|------|-------------|---------|
| **Application** | Require approval to join | ✅ Yes |
| **Minimum Payout** | Threshold for payout | €50 |
| **Commission Rate** | Percentage of sale | 10-30% |
| **Cookie Duration** | Attribution window | 30-90 days |
| **Recurring Duration** | How long recurring commissions last | 12 months |
| **Chargebacks** | Handle refunds | Deduct from balance |
| **Payment Terms** | When payments are made | Net 30 |
| **Tax Forms** | Require W-9/W-8BEN | Above thresholds |

---

## 3.4 Employee Referral Program (V1.2)

### Definition

Internal employees refer candidates for hiring or customers for sales.

### Characteristics

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  EMPLOYEE REFERRAL PROGRAM                                      │
│                                                                 │
│  Who Can Refer:     Employees of the Client company             │
│  Who Is Referred:   Potential hires OR customers                │
│  Relationship:      Professional network                        │
│  Trust Level:       High (employee vouches)                     │
│  Volume:            Low-Medium (limited by headcount)           │
│  Quality:           High (pre-vetted)                           │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GROWTH TARGET                                                  │
│                                                                 │
│  • Quality hires (HR use case)                                  │
│  • Sales leads (sales use case)                                 │
│  • Reduce recruiting costs                                      │
│  • Employee engagement                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Compatible Reward Types

| Reward Type | Compatibility | Notes |
|-------------|---------------|-------|
| Cash Bonus | ✅ Excellent | Most common |
| Extra PTO | ✅ Good | Non-monetary option |
| Gift Cards | ✅ Good | Easy to administer |
| Charity Donation | ✅ Good | Match to charity |
| Swag | ⚠️ Moderate | Lower value |

---

## 3.5 Partner / Reseller Program (V2)

### Definition

Business partners (agencies, consultants, resellers) refer clients for ongoing revenue share.

### Characteristics

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  PARTNER / RESELLER PROGRAM                                     │
│                                                                 │
│  Who Can Refer:     Business partners, agencies, consultants    │
│  Who Is Referred:   Their clients                               │
│  Relationship:      B2B, contractual                            │
│  Trust Level:       High (business reputation)                  │
│  Volume:            Low-Medium (larger deals)                   │
│  Quality:           High (vetted by partner)                    │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GROWTH TARGET                                                  │
│                                                                 │
│  • Enterprise sales                                             │
│  • Market expansion                                             │
│  • Channel sales                                                │
│  • Strategic partnerships                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Compatible Reward Types

| Reward Type | Compatibility | Notes |
|-------------|---------------|-------|
| Revenue Share | ✅ Excellent | 10-30% ongoing |
| Tiered Commission | ✅ Excellent | Higher for more sales |
| Reseller Discount | ✅ Excellent | Buy at discount, sell at retail |
| Deal Registration | ✅ Excellent | Protect partner deals |
| MDF (Market Development Funds) | ✅ Good | Co-marketing support |

---

## 3.6 Influencer Program (V2)

### Definition

Social media influencers and content creators promote the product to their audience.

### Characteristics

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  INFLUENCER PROGRAM                                             │
│                                                                 │
│  Who Can Refer:     Influencers, content creators               │
│  Who Is Referred:   Their followers                             │
│  Relationship:      One-to-many (broadcast)                     │
│  Trust Level:       Medium (parasocial relationship)            │
│  Volume:            High (reach-based)                          │
│  Quality:           Variable (audience match matters)           │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GROWTH TARGET                                                  │
│                                                                 │
│  • Brand awareness                                              │
│  • Reach new demographics                                       │
│  • Social proof                                                 │
│  • Content creation                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3.7 Ambassador Program (V2)

### Definition

Long-term advocates who represent the brand consistently over time.

### Characteristics

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  AMBASSADOR PROGRAM                                             │
│                                                                 │
│  Who Can Refer:     Selected brand ambassadors                  │
│  Who Is Referred:   Their network and community                 │
│  Relationship:      Ongoing, deep engagement                    │
│  Trust Level:       Very High (genuine advocates)               │
│  Volume:            Medium (quality over quantity)              │
│  Quality:           Very High (true believers)                  │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GROWTH TARGET                                                  │
│                                                                 │
│  • Community building                                           │
│  • Brand loyalty                                                │
│  • User-generated content                                       │
│  • Product feedback                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3.8 Contest / Sweepstakes (V1.2)

### Definition

Time-limited competition where referrers compete for prizes.

### Characteristics

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  CONTEST / SWEEPSTAKES                                          │
│                                                                 │
│  Who Can Refer:     Anyone who enters                           │
│  Who Is Referred:   Anyone                                      │
│  Relationship:      Competition-driven                          │
│  Trust Level:       Lower (incentive-driven)                    │
│  Volume:            Very High (gamification)                    │
│  Quality:           Lower (quantity focus)                      │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GROWTH TARGET                                                  │
│                                                                 │
│  • Burst of signups                                             │
│  • Viral moment                                                 │
│  • Event-driven growth                                          │
│  • Seasonal campaigns                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Compatible Reward Types

| Reward Type | Compatibility | Notes |
|-------------|---------------|-------|
| Grand Prize | ✅ Excellent | Top referrer wins |
| Tiered Prizes | ✅ Excellent | 1st, 2nd, 3rd, etc. |
| Random Draw | ✅ Good | Each referral = entry |
| Milestone Prizes | ✅ Good | At 5, 10, 25 referrals |
| Everyone Gets Something | ✅ Good | Participation rewards |

---

# 3️⃣.B Referrer Onboarding Flows

## Overview: How Each Referrer Type Joins

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ONBOARDING SUMMARY BY TYPE                                     │
│                                                                 │
│  Type              │ How They Join        │ Approval │ Portal   │
│  ──────────────────┼──────────────────────┼──────────┼──────────│
│  Customer Referrer │ Auto (via widget)    │ Auto     │ Widget   │
│  User Referrer     │ Auto (via widget)    │ Auto     │ Widget   │
│  Affiliate         │ Application form     │ Manual   │ Full     │
│  Partner/Reseller  │ Invitation + Contract│ Manual   │ Full     │
│  Influencer        │ Invitation           │ Manual   │ Full     │
│  Ambassador        │ Selection/Invitation │ Manual   │ Full     │
│  Employee          │ Company SSO          │ Auto     │ Internal │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3.B.1 Customer/User Referrer Onboarding (MVP)

### Flow: Automatic, No Approval Needed

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  CUSTOMER REFERRER ONBOARDING                                   │
│                                                                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. DISCOVERY                                             │   │
│  │                                                          │   │
│  │    Customer is using Client's app                        │   │
│  │    Sees referral widget (sidebar, dashboard, or prompt)  │   │
│  │    Widget shows: "Refer friends, earn €20"               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 2. ENROLLMENT (Instant)                                  │   │
│  │                                                          │   │
│  │    Customer clicks "Get my link"                         │   │
│  │    System auto-generates:                                │   │
│  │    • Unique referral link                                │   │
│  │    • Unique referral code (e.g., JOHN-X7K9)              │   │
│  │    NO form to fill, NO approval needed                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 3. READY TO SHARE                                        │   │
│  │                                                          │   │
│  │    Widget shows:                                         │   │
│  │    • Referral link (with copy button)                    │   │
│  │    • Share buttons (Email, WhatsApp, LinkedIn)           │   │
│  │    • Current stats (0 referrals, €0 earned)              │   │
│  │    Customer is now an ACTIVE REFERRER                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  TIME TO ACTIVATE: < 10 seconds                                 │
│  FRICTION: Minimal                                              │
│  ACCOUNT CREATED: No (uses existing Client account)             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Captured

| Field | Source | Required |
|-------|--------|----------|
| User ID | Client's system | Yes |
| Email | Client's system | Yes |
| Name | Client's system | Optional |
| Referral Code | Auto-generated | Yes |
| Enrolled Date | System | Yes |

---

## 3.B.2 Affiliate Onboarding (V1.2)

### Flow: Application → Review → Approval → Portal Access

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  AFFILIATE ONBOARDING                                           │
│                                                                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. DISCOVERY                                             │   │
│  │                                                          │   │
│  │    Potential affiliate finds program via:                │   │
│  │    • Client's website "Affiliate Program" page           │   │
│  │    • Affiliate networks/directories                      │   │
│  │    • Word of mouth                                       │   │
│  │    • Client's outreach                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 2. APPLICATION                                           │   │
│  │                                                          │   │
│  │    Applicant fills out form:                             │   │
│  │    • Name, Email                                         │   │
│  │    • Website/Blog URL                                    │   │
│  │    • Social media profiles                               │   │
│  │    • How they plan to promote                            │   │
│  │    • Audience size/type                                  │   │
│  │    • Why they want to join                               │   │
│  │    • Agrees to terms & conditions                        │   │
│  │                                                          │   │
│  │    Status: PENDING                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 3. REVIEW (by Client Admin)                              │   │
│  │                                                          │   │
│  │    Client Admin reviews application:                     │   │
│  │    • Checks website quality                              │   │
│  │    • Verifies audience relevance                         │   │
│  │    • Checks for policy violations                        │   │
│  │                                                          │   │
│  │    Decision: APPROVE / REJECT / REQUEST INFO             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│           ┌───────────────┴───────────────┐                     │
│           │                               │                     │
│           ▼                               ▼                     │
│  ┌─────────────────┐             ┌─────────────────┐            │
│  │    APPROVED     │             │    REJECTED     │            │
│  └────────┬────────┘             └─────────────────┘            │
│           │                              │                      │
│           │                              ▼                      │
│           │                      Email: "Sorry, not a fit"      │
│           │                      (with reason, if configured)   │
│           │                                                     │
│           ▼                                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 4. ACCOUNT CREATION                                      │   │
│  │                                                          │   │
│  │    System creates affiliate account:                     │   │
│  │    • Account in ReferralAI platform                      │   │
│  │    • Unique affiliate ID                                 │   │
│  │    • Unique tracking links                               │   │
│  │    • Default commission tier assigned                    │   │
│  │                                                          │   │
│  │    Email sent: "Welcome! Set your password"              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 5. PORTAL ACCESS                                         │   │
│  │                                                          │   │
│  │    Affiliate logs into portal:                           │   │
│  │    partners.clientapp.com                                │   │
│  │                                                          │   │
│  │    Portal includes:                                      │   │
│  │    • Dashboard (stats, earnings)                         │   │
│  │    • Links & tracking codes                              │   │
│  │    • Marketing materials (banners, copy)                 │   │
│  │    • Payout settings                                     │   │
│  │    • Reports & analytics                                 │   │
│  │    • Support/resources                                   │   │
│  │                                                          │   │
│  │    Status: ACTIVE                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  TIME TO ACTIVATE: 1-7 days (depends on review speed)           │
│  FRICTION: Medium (application required)                        │
│  ACCOUNT CREATED: Yes (in ReferralAI platform)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Application Form Fields

| Field | Required | Purpose |
|-------|----------|---------|
| Full Name | Yes | Identity |
| Email | Yes | Account creation, communication |
| Company Name | Optional | Business affiliates |
| Website URL | Yes | Quality check |
| Social Profiles | Optional | Reach assessment |
| Audience Size | Yes | Potential value |
| Audience Type | Yes | Relevance check |
| Promotion Methods | Yes | Compliance check |
| Why Join | Optional | Intent understanding |
| Tax Country | Yes | Payout compliance |
| Agreed to Terms | Yes | Legal |

### Affiliate Statuses

| Status | Description |
|--------|-------------|
| **Pending** | Application submitted, awaiting review |
| **Under Review** | Admin is reviewing |
| **Approved** | Accepted, account created |
| **Rejected** | Not accepted |
| **Active** | Approved and actively promoting |
| **Inactive** | No activity for 90+ days |
| **Suspended** | Temporarily disabled (policy violation) |
| **Terminated** | Permanently removed |

---

## 3.B.3 Partner/Reseller Onboarding (V2)

### Flow: Invitation/Outreach → Negotiation → Contract → Portal Access

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  PARTNER/RESELLER ONBOARDING                                    │
│                                                                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. IDENTIFICATION                                        │   │
│  │                                                          │   │
│  │    Client identifies potential partner:                  │   │
│  │    • Agency serving target market                        │   │
│  │    • Consultant with relevant clients                    │   │
│  │    • Complementary software vendor                       │   │
│  │    • System integrator                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 2. OUTREACH & NEGOTIATION                                │   │
│  │                                                          │   │
│  │    • Initial conversation                                │   │
│  │    • Program terms discussion                            │   │
│  │    • Commission/discount negotiation                     │   │
│  │    • Partnership tier assignment                         │   │
│  │                                                          │   │
│  │    Tiers: Bronze / Silver / Gold / Platinum              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 3. CONTRACT & AGREEMENT                                  │   │
│  │                                                          │   │
│  │    • Partner Agreement signed                            │   │
│  │    • NDA if required                                     │   │
│  │    • Payment terms agreed                                │   │
│  │    • Territory/exclusivity defined (if any)              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 4. ACCOUNT SETUP                                         │   │
│  │                                                          │   │
│  │    Client Admin creates partner account:                 │   │
│  │    • Company profile                                     │   │
│  │    • Primary contact                                     │   │
│  │    • Additional team members                             │   │
│  │    • Commission tier configured                          │   │
│  │    • Custom terms applied                                │   │
│  │                                                          │   │
│  │    Invitation email sent to partner                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 5. ONBOARDING & TRAINING                                 │   │
│  │                                                          │   │
│  │    • Portal access granted                               │   │
│  │    • Product training scheduled                          │   │
│  │    • Sales enablement materials provided                 │   │
│  │    • Demo account provisioned                            │   │
│  │    • Dedicated partner manager assigned (for top tiers)  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 6. ACTIVE PARTNERSHIP                                    │   │
│  │                                                          │   │
│  │    Partner portal includes:                              │   │
│  │    • Deal registration                                   │   │
│  │    • Lead/opportunity tracking                           │   │
│  │    • Commission reports                                  │   │
│  │    • Marketing materials (co-branded)                    │   │
│  │    • MDF (Market Development Funds) requests             │   │
│  │    • Training & certification                            │   │
│  │    • Support escalation                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  TIME TO ACTIVATE: 2-8 weeks (negotiation, contract)            │
│  FRICTION: High (formal process)                                │
│  ACCOUNT CREATED: Yes (company + individual accounts)           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Partner Account Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  PARTNER ACCOUNT HIERARCHY                                      │
│                                                                 │
│  Partner Company Account                                        │
│  ├── Company Profile                                            │
│  │   ├── Company Name                                           │
│  │   ├── Address                                                │
│  │   ├── Tax ID                                                 │
│  │   ├── Partner Tier (Bronze/Silver/Gold/Platinum)             │
│  │   └── Contract Details                                       │
│  │                                                              │
│  ├── Team Members                                               │
│  │   ├── Partner Admin (manages account)                        │
│  │   ├── Sales Rep 1 (own deals)                                │
│  │   ├── Sales Rep 2 (own deals)                                │
│  │   └── ...                                                    │
│  │                                                              │
│  ├── Deals/Opportunities                                        │
│  │   ├── Deal 1 (registered by Sales Rep 1)                     │
│  │   ├── Deal 2 (registered by Sales Rep 2)                     │
│  │   └── ...                                                    │
│  │                                                              │
│  └── Commission Balance                                         │
│      └── Paid to company, not individuals                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3.B.4 Influencer Onboarding (V2)

### Flow: Recruitment → Invitation → Accept → Portal Access

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  INFLUENCER ONBOARDING                                          │
│                                                                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. RECRUITMENT                                           │   │
│  │                                                          │   │
│  │    Client identifies influencers:                        │   │
│  │    • Search on social platforms                          │   │
│  │    • Influencer marketplaces                             │   │
│  │    • Industry events/communities                         │   │
│  │    • Inbound applications                                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 2. OUTREACH                                              │   │
│  │                                                          │   │
│  │    Client reaches out with offer:                        │   │
│  │    • Commission structure                                │   │
│  │    • Free product access                                 │   │
│  │    • Exclusive perks                                     │   │
│  │    • Content requirements (if any)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 3. INVITATION                                            │   │
│  │                                                          │   │
│  │    Client Admin sends invitation via platform:           │   │
│  │    • Personalized invite link                            │   │
│  │    • Custom commission terms (if negotiated)             │   │
│  │    • Welcome message                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 4. ACCEPTANCE                                            │   │
│  │                                                          │   │
│  │    Influencer clicks invite link:                        │   │
│  │    • Creates account (email, password)                   │   │
│  │    • Provides social profiles                            │   │
│  │    • Agrees to terms (incl. FTC disclosure requirements) │   │
│  │    • Sets payout preferences                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 5. PORTAL ACCESS                                         │   │
│  │                                                          │   │
│  │    Influencer portal includes:                           │   │
│  │    • Unique tracking links                               │   │
│  │    • Discount codes (for followers)                      │   │
│  │    • Performance dashboard                               │   │
│  │    • Content guidelines & assets                         │   │
│  │    • Payout info                                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3.B.5 Ambassador Onboarding (V2)

### Flow: Selection → Invitation → Vetting → Exclusive Access

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  AMBASSADOR ONBOARDING                                          │
│                                                                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. IDENTIFICATION                                        │   │
│  │                                                          │   │
│  │    Client identifies top advocates:                      │   │
│  │    • Power users of the product                          │   │
│  │    • Top referrers from existing program                 │   │
│  │    • Community contributors                              │   │
│  │    • Brand enthusiasts                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 2. EXCLUSIVE INVITATION                                  │   │
│  │                                                          │   │
│  │    Personalized invitation:                              │   │
│  │    "You've been selected as a [Brand] Ambassador"        │   │
│  │    • Exclusive benefits outlined                         │   │
│  │    • Expectations explained                              │   │
│  │    • Limited spots (exclusivity)                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 3. APPLICATION/INTERVIEW                                 │   │
│  │                                                          │   │
│  │    Ambassador applicant:                                 │   │
│  │    • Completes detailed application                      │   │
│  │    • May have video interview                            │   │
│  │    • Background check (for some programs)                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 4. AMBASSADOR PORTAL                                     │   │
│  │                                                          │   │
│  │    Exclusive portal with:                                │   │
│  │    • Enhanced commission rates                           │   │
│  │    • Early access to features                            │   │
│  │    • Direct line to product team                         │   │
│  │    • Exclusive swag/merchandise                          │   │
│  │    • Ambassador community access                         │   │
│  │    • Co-marketing opportunities                          │   │
│  │    • Speaking opportunities                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3.B.6 Employee Referral Onboarding (V1.2)

### Flow: Company SSO → Auto-Enrollment → Internal Portal

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  EMPLOYEE REFERRAL ONBOARDING                                   │
│                                                                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. COMPANY SETUP (by Client Admin)                       │   │
│  │                                                          │   │
│  │    HR/Admin configures:                                  │   │
│  │    • SSO integration (Okta, Azure AD, Google Workspace)  │   │
│  │    • Which employees can participate                     │   │
│  │    • Reward structure                                    │   │
│  │    • Eligible positions/departments                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 2. EMPLOYEE ACCESS                                       │   │
│  │                                                          │   │
│  │    Employee receives link to portal                      │   │
│  │    Logs in with company SSO                              │   │
│  │    Automatically enrolled (no application)               │   │
│  │    Gets unique referral link                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 3. INTERNAL PORTAL                                       │   │
│  │                                                          │   │
│  │    Employee portal includes:                             │   │
│  │    • Referral link for open positions                    │   │
│  │    • List of open positions                              │   │
│  │    • Referral status tracking                            │   │
│  │    • Reward balance                                      │   │
│  │    • Leaderboard (optional)                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SPECIAL: Employee referrals may need HR integration            │
│           (track candidate through hiring pipeline)             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

# 3️⃣.C Metrics by Referrer Type

## Overview: Different Metrics for Different Types

Not all referrer types need the same metrics. Here's what to track for each:

---

## 3.C.1 Customer/User Referrer Metrics (MVP)

### Individual Referrer Metrics

| Metric | Description | Purpose |
|--------|-------------|---------|
| **Referral Link** | Their unique URL | Tracking |
| **Total Shares** | Times they shared (if trackable) | Engagement |
| **Total Clicks** | Clicks on their link | Reach |
| **Total Signups** | Signups from their link | Top-of-funnel |
| **Total Conversions** | Paid conversions | Revenue |
| **Conversion Rate** | Conversions / Clicks | Quality |
| **Total Revenue Generated** | Sum of referred revenue | Value |
| **Total Rewards Earned** | Sum of rewards | Cost |
| **Pending Rewards** | Not yet paid out | Liability |
| **Paid Rewards** | Already paid out | Cost |
| **Last Activity Date** | When they last shared/earned | Engagement |
| **Days Since Last Activity** | For dormancy detection | Churn risk |

### Aggregate Metrics (All Customer Referrers)

| Metric | Description |
|--------|-------------|
| **Total Referrers** | How many customers joined program |
| **Active Referrers** | Shared at least once |
| **Referrers with Conversions** | Had at least 1 conversion |
| **Referrer Activation Rate** | Active / Total |
| **Referrer Success Rate** | With Conversions / Active |
| **Top Referrers** | Ranked by conversions or revenue |
| **Dormant Referrers** | No activity 30+ days |

---

## 3.C.2 Affiliate Metrics (V1.2)

### Individual Affiliate Metrics

| Metric | Description | Purpose |
|--------|-------------|---------|
| **Affiliate ID** | Unique identifier | Tracking |
| **Status** | Active, Inactive, Suspended | Management |
| **Tier** | Commission tier | Compensation |
| **Application Date** | When they applied | Tenure |
| **Approval Date** | When they were approved | Tenure |
| **Total Clicks** | All-time clicks | Reach |
| **Total Conversions** | All-time conversions | Performance |
| **Conversion Rate** | Conversions / Clicks | Quality |
| **Total Revenue Generated** | Lifetime revenue | Value |
| **Average Order Value** | Avg transaction size | Quality |
| **Total Commissions Earned** | Lifetime earnings | Cost |
| **Pending Commissions** | Awaiting payout | Liability |
| **Paid Commissions** | Already paid | Cost |
| **Last Click Date** | Most recent click | Activity |
| **Last Conversion Date** | Most recent sale | Activity |
| **Chargeback Rate** | Refunds / Conversions | Quality/Fraud |
| **Traffic Sources** | Where clicks come from | Compliance |

### Aggregate Metrics (All Affiliates)

| Metric | Description |
|--------|-------------|
| **Total Affiliates** | All approved affiliates |
| **Active Affiliates** | Activity in last 30 days |
| **Pending Applications** | Awaiting review |
| **Approval Rate** | Approved / Applied |
| **Top Affiliates** | By revenue or conversions |
| **Affiliate Revenue** | Total revenue from affiliates |
| **Commission Payout Ratio** | Commissions / Revenue |
| **Average Affiliate Value** | Revenue per affiliate |
| **Affiliate Churn Rate** | Inactive / Total |

---

## 3.C.3 Partner/Reseller Metrics (V2)

### Individual Partner Metrics

| Metric | Description | Purpose |
|--------|-------------|---------|
| **Partner ID** | Unique identifier | Tracking |
| **Partner Tier** | Bronze/Silver/Gold/Platinum | Relationship |
| **Company Name** | Legal entity | Identification |
| **Contract Start Date** | When partnership began | Tenure |
| **Contract Value** | Expected annual value | Forecasting |
| **Primary Contact** | Main point of contact | Communication |
| **Team Members** | People in partner account | Capacity |
| **Registered Deals** | Deals they've registered | Pipeline |
| **Won Deals** | Deals that closed | Revenue |
| **Win Rate** | Won / Registered | Effectiveness |
| **Total Revenue** | Lifetime revenue from partner | Value |
| **Total Commissions** | Lifetime commissions | Cost |
| **Average Deal Size** | Avg transaction | Quality |
| **Active Deals** | Currently in pipeline | Forecasting |
| **MDF Used** | Marketing funds utilized | Investment |
| **Training Completed** | Certifications earned | Capability |
| **Last Deal Registered** | Most recent activity | Engagement |
| **Partner NPS** | Satisfaction score | Relationship |

### Aggregate Metrics (All Partners)

| Metric | Description |
|--------|-------------|
| **Total Partners** | All active partners |
| **Partners by Tier** | Breakdown by tier |
| **Total Pipeline Value** | All registered deals |
| **Partner-Sourced Revenue** | % of total revenue |
| **Average Partner Value** | Revenue per partner |
| **Partner Satisfaction** | Aggregate NPS |
| **Partner Churn** | Lost partners |
| **Top Partners** | By revenue |

---

## 3.C.4 Influencer Metrics (V2)

### Individual Influencer Metrics

| Metric | Description | Purpose |
|--------|-------------|---------|
| **Influencer ID** | Unique identifier | Tracking |
| **Platform(s)** | YouTube, Twitter, etc. | Reach |
| **Follower Count** | Total followers | Reach |
| **Engagement Rate** | Avg engagement | Quality |
| **Content Posts** | Posts about product | Activity |
| **Total Clicks** | From their content | Performance |
| **Total Conversions** | Sales generated | Revenue |
| **Conversion Rate** | Conversions / Clicks | Quality |
| **Revenue Generated** | Total revenue | Value |
| **Cost Per Acquisition** | Commission / Conversions | Efficiency |
| **Commissions Paid** | Total paid | Cost |
| **ROI** | Revenue / Commissions | Efficiency |
| **Last Post Date** | Most recent content | Activity |
| **Content Quality Score** | Internal rating | Quality |

### Aggregate Metrics (All Influencers)

| Metric | Description |
|--------|-------------|
| **Total Influencers** | Active influencers |
| **By Platform** | Breakdown by social platform |
| **Total Reach** | Combined followers |
| **Influencer Revenue** | Revenue from influencers |
| **Avg ROI** | Average return |
| **Top Influencers** | By revenue or engagement |

---

## 3.C.5 Ambassador Metrics (V2)

### Individual Ambassador Metrics

| Metric | Description | Purpose |
|--------|-------------|---------|
| **Ambassador ID** | Unique identifier | Tracking |
| **Ambassador Since** | Date joined | Tenure |
| **Status** | Active, On Hold, Alumni | Management |
| **Total Referrals** | Lifetime referrals | Performance |
| **Total Revenue** | Revenue generated | Value |
| **Community Contributions** | Forum posts, answers | Engagement |
| **Content Created** | Blog posts, videos | Advocacy |
| **Events Attended** | Conferences, meetups | Representation |
| **Beta Features Tested** | Early access usage | Feedback |
| **Product Feedback Given** | Suggestions submitted | Value |
| **Rewards Earned** | Commissions + perks | Cost |
| **Ambassador Score** | Internal rating | Quality |

### Aggregate Metrics (All Ambassadors)

| Metric | Description |
|--------|-------------|
| **Total Ambassadors** | Active ambassadors |
| **Ambassador Tenure** | Avg time in program |
| **Ambassador Revenue** | Revenue from ambassadors |
| **Community Impact** | Contributions, content |
| **Ambassador NPS** | Satisfaction |
| **Top Ambassadors** | By impact score |

---

## 3.C.6 Employee Referral Metrics (V1.2)

### Individual Employee Metrics

| Metric | Description | Purpose |
|--------|-------------|---------|
| **Employee ID** | From HR system | Tracking |
| **Department** | Which team | Segmentation |
| **Referrals Submitted** | Candidates referred | Activity |
| **Referrals Interviewed** | Made it to interview | Quality |
| **Referrals Hired** | Got the job | Success |
| **Hire Rate** | Hired / Submitted | Quality |
| **Rewards Earned** | Bonuses earned | Cost |
| **Time to Hire** | Avg for their referrals | Speed |
| **New Hire Retention** | 6-month retention of hires | Quality |
| **Last Referral Date** | Most recent referral | Activity |

### Aggregate Metrics (All Employees)

| Metric | Description |
|--------|-------------|
| **Participating Employees** | Who have referred |
| **Participation Rate** | Participants / Total employees |
| **Total Referrals** | All submissions |
| **Total Hires** | From referrals |
| **Referral Hire Rate** | Hires / Submissions |
| **Referral % of Hires** | Referral hires / All hires |
| **Cost Per Hire** | Rewards / Hires |
| **Referral Quality Score** | Retention, performance |
| **Top Referrers** | By hires |

---

## Metrics Comparison Table

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                    │
│  KEY METRICS BY REFERRER TYPE                                                      │
│                                                                                    │
│                        │Customer│Affiliate│Partner │Influencer│Ambassador│Employee│
│  ──────────────────────┼────────┼─────────┼────────┼──────────┼──────────┼────────│
│                        │        │         │        │          │          │        │
│  Clicks                │   ✅   │   ✅    │   ⚠️   │    ✅    │    ✅    │   ❌   │
│  Conversions           │   ✅   │   ✅    │   ✅   │    ✅    │    ✅    │   ✅   │
│  Revenue Generated     │   ✅   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│  Conversion Rate       │   ✅   │   ✅    │   ✅   │    ✅    │    ✅    │   ✅   │
│  Commissions Earned    │   ✅   │   ✅    │   ✅   │    ✅    │    ✅    │   ✅   │
│                        │        │         │        │          │          │        │
│  Application Status    │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│  Tier/Level            │   ❌   │   ✅    │   ✅   │    ⚠️    │    ✅    │   ❌   │
│  Deal Registration     │   ❌   │   ❌    │   ✅   │    ❌    │    ❌    │   ❌   │
│  Pipeline Value        │   ❌   │   ❌    │   ✅   │    ❌    │    ❌    │   ❌   │
│                        │        │         │        │          │          │        │
│  Follower Count        │   ❌   │   ⚠️    │   ❌   │    ✅    │    ⚠️    │   ❌   │
│  Content Posts         │   ❌   │   ❌    │   ❌   │    ✅    │    ✅    │   ❌   │
│  Engagement Rate       │   ❌   │   ❌    │   ❌   │    ✅    │    ⚠️    │   ❌   │
│                        │        │         │        │          │          │        │
│  Candidates Submitted  │   ❌   │   ❌    │   ❌   │    ❌    │    ❌    │   ✅   │
│  Hires Made            │   ❌   │   ❌    │   ❌   │    ❌    │    ❌    │   ✅   │
│  New Hire Retention    │   ❌   │   ❌    │   ❌   │    ❌    │    ❌    │   ✅   │
│                        │        │         │        │          │          │        │
│  Community Contrib.    │   ❌   │   ❌    │   ❌   │    ❌    │    ✅    │   ❌   │
│  Product Feedback      │   ❌   │   ❌    │   ⚠️   │    ❌    │    ✅    │   ❌   │
│                        │        │         │        │          │          │        │
│  ──────────────────────┴────────┴─────────┴────────┴──────────┴──────────┴────────│
│                                                                                    │
│  Legend:  ✅ Primary metric    ⚠️ Optional/secondary    ❌ Not applicable          │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

# 4️⃣ Reward Types

## Overview

A **Reward Type** defines what the referrer (and optionally referee) receives.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  REWARD CATEGORIES                                              │
│                                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    MONETARY                             │    │
│  │                                                         │    │
│  │  💵 Cash (Fixed)                                        │    │
│  │  💵 Cash (Percentage)                                   │    │
│  │  💵 Cash (Recurring)                                    │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    VALUE-BASED                          │    │
│  │                                                         │    │
│  │  🏷️ Discount Code (Percentage)                          │    │
│  │  🏷️ Discount Code (Fixed Amount)                        │    │
│  │  💳 Account Credit                                      │    │
│  │  🎁 Gift Card                                           │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   PRODUCT-BASED                         │    │
│  │                                                         │    │
│  │  ⭐ Feature Unlock                                       │    │
│  │  ⏫ Plan Upgrade                                         │    │
│  │  ⏳ Extended Trial                                       │    │
│  │  📦 Free Product/Service                                │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    STATUS-BASED                         │    │
│  │                                                         │    │
│  │  📍 Position Boost (waitlist)                           │    │
│  │  🚀 Early Access                                        │    │
│  │  🏆 VIP Status                                          │    │
│  │  🎖️ Badge/Recognition                                   │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    OTHER                                │    │
│  │                                                         │    │
│  │  ❤️ Charity Donation                                    │    │
│  │  👕 Physical Merchandise                                │    │
│  │  🎟️ Event Access                                        │    │
│  │  🎲 Contest Entries                                     │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Monetary Rewards

### 4.1 Cash - Fixed Amount

| Attribute | Description |
|-----------|-------------|
| **Definition** | Fixed money amount per successful referral |
| **Example** | "€20 for every friend who signs up" |
| **Paid Via** | PayPal, Wise, Bank Transfer |
| **Best For** | Simple programs, easy to understand |
| **Pros** | Clear value, universal appeal |
| **Cons** | Cost is fixed regardless of deal size |

**Trigger Options:**
- On signup (risky, low quality)
- On trial start (moderate)
- On first purchase (recommended)
- On subscription start (recommended for SaaS)

---

### 4.2 Cash - Percentage

| Attribute | Description |
|-----------|-------------|
| **Definition** | Percentage of the referred customer's payment |
| **Example** | "20% of your friend's first purchase" |
| **Paid Via** | PayPal, Wise, Bank Transfer |
| **Best For** | Variable pricing, aligns incentives |
| **Pros** | Scales with deal size, fair |
| **Cons** | Harder to communicate, variable earnings |

**Calculation Examples:**
- 20% of €99 purchase = €19.80
- 20% of €499 purchase = €99.80
- 20% of €49/month subscription = €9.80

---

### 4.3 Cash - Recurring

| Attribute | Description |
|-----------|-------------|
| **Definition** | Ongoing percentage for the lifetime of the referred subscription |
| **Example** | "15% of your friend's subscription, every month" |
| **Paid Via** | PayPal, Wise, Bank Transfer (monthly) |
| **Best For** | SaaS, subscription businesses |
| **Pros** | Long-term relationship, passive income |
| **Cons** | Complex tracking, ongoing liability |

**Duration Options:**
- Forever (lifetime)
- 12 months
- First year only
- Until referrer churns

---

## Value-Based Rewards

### 4.4 Discount Code - Percentage

| Attribute | Description |
|-----------|-------------|
| **Definition** | Percentage off future purchases |
| **Example** | "Get 25% off your next purchase" |
| **Applied To** | Referrer or Referee (two-sided) |
| **Best For** | E-commerce, repeat purchases |
| **Pros** | Encourages retention, no cash outflow |
| **Cons** | Only valuable if they buy again |

---

### 4.5 Discount Code - Fixed Amount

| Attribute | Description |
|-----------|-------------|
| **Definition** | Fixed amount off future purchases |
| **Example** | "Get €20 off your next purchase" |
| **Applied To** | Referrer or Referee (two-sided) |
| **Best For** | Clear value communication |
| **Pros** | Easy to understand |
| **Cons** | May require minimum purchase |

---

### 4.6 Account Credit

| Attribute | Description |
|-----------|-------------|
| **Definition** | Credit added to the referrer's account balance |
| **Example** | "€20 credit added to your account" |
| **Usage** | Applied to future invoices |
| **Best For** | SaaS, keeping money in ecosystem |
| **Pros** | No cash outflow, increases LTV |
| **Cons** | Only valuable if they stay |

---

### 4.7 Gift Card

| Attribute | Description |
|-----------|-------------|
| **Definition** | Third-party gift card (Amazon, etc.) |
| **Example** | "€20 Amazon gift card" |
| **Delivery** | Email (digital gift card) |
| **Best For** | Universal appeal, no product tie |
| **Pros** | Everyone values it |
| **Cons** | Adds complexity, third-party costs |

---

## Product-Based Rewards

### 4.8 Feature Unlock

| Attribute | Description |
|-----------|-------------|
| **Definition** | Unlock premium features as reward |
| **Example** | "Unlock advanced analytics for free" |
| **Duration** | Permanent or time-limited |
| **Best For** | Freemium products |
| **Pros** | Increases product engagement |
| **Cons** | Only works with freemium |

---

### 4.9 Plan Upgrade

| Attribute | Description |
|-----------|-------------|
| **Definition** | Free upgrade to higher tier |
| **Example** | "Get Pro plan free for 3 months" |
| **Duration** | Usually time-limited |
| **Best For** | SaaS with clear tier differences |
| **Pros** | Showcases premium value |
| **Cons** | Downgrade friction later |

---

### 4.10 Extended Trial

| Attribute | Description |
|-----------|-------------|
| **Definition** | Extra time on free trial |
| **Example** | "Get 30 more days of trial" |
| **Best For** | Products with trial periods |
| **Pros** | Low cost, increases conversion window |
| **Cons** | Limited appeal |

---

## Status-Based Rewards

### 4.11 Position Boost (Waitlist)

| Attribute | Description |
|-----------|-------------|
| **Definition** | Move up positions in a waitlist |
| **Example** | "Move up 100 spots per referral" |
| **Best For** | Waitlist/viral launch campaigns |
| **Pros** | Creates urgency, viral mechanic |
| **Cons** | Only works pre-launch |

---

### 4.12 Early Access

| Attribute | Description |
|-----------|-------------|
| **Definition** | Get access before general availability |
| **Example** | "Get beta access immediately" |
| **Best For** | New features, new products |
| **Pros** | Creates exclusivity |
| **Cons** | Time-limited value |

---

### 4.13 VIP Status

| Attribute | Description |
|-----------|-------------|
| **Definition** | Special status with perks |
| **Example** | "Become a VIP member with exclusive benefits" |
| **Perks** | Priority support, early access, exclusive events |
| **Best For** | Community-focused products |
| **Pros** | Creates loyalty |
| **Cons** | Requires ongoing maintenance |

---

# 5️⃣ Reward-Campaign Compatibility Matrix

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                    │
│  REWARD TYPE vs CAMPAIGN TYPE COMPATIBILITY                                        │
│                                                                                    │
│                        │ User    │ Wait-  │ Affil- │ Employee│ Partner │ Contest │
│  REWARD TYPE           │ Referral│ list   │ iate   │ Referral│ Program │         │
│  ──────────────────────┼─────────┼────────┼────────┼─────────┼─────────┼─────────│
│                        │         │        │        │         │         │         │
│  💵 Cash (Fixed)       │   ✅    │   ⚠️   │   ✅   │   ✅    │   ✅    │   ✅    │
│  💵 Cash (Percentage)  │   ✅    │   ❌   │   ✅   │   ⚠️    │   ✅    │   ⚠️    │
│  💵 Cash (Recurring)   │   ✅    │   ❌   │   ✅   │   ❌    │   ✅    │   ❌    │
│                        │         │        │        │         │         │         │
│  🏷️ Discount (%)       │   ✅    │   ✅   │   ⚠️   │   ❌    │   ⚠️    │   ✅    │
│  🏷️ Discount (Fixed)   │   ✅    │   ✅   │   ⚠️   │   ❌    │   ⚠️    │   ✅    │
│  💳 Account Credit     │   ✅    │   ⚠️   │   ❌   │   ❌    │   ⚠️    │   ✅    │
│  🎁 Gift Card          │   ✅    │   ⚠️   │   ⚠️   │   ✅    │   ⚠️    │   ✅    │
│                        │         │        │        │         │         │         │
│  ⭐ Feature Unlock     │   ✅    │   ✅   │   ❌   │   ❌    │   ❌    │   ✅    │
│  ⏫ Plan Upgrade       │   ✅    │   ✅   │   ❌   │   ❌    │   ❌    │   ✅    │
│  ⏳ Extended Trial     │   ✅    │   ✅   │   ❌   │   ❌    │   ❌    │   ⚠️    │
│                        │         │        │        │         │         │         │
│  📍 Position Boost     │   ❌    │   ✅   │   ❌   │   ❌    │   ❌    │   ❌    │
│  🚀 Early Access       │   ⚠️    │   ✅   │   ❌   │   ❌    │   ⚠️    │   ✅    │
│  🏆 VIP Status         │   ✅    │   ⚠️   │   ❌   │   ❌    │   ⚠️    │   ✅    │
│                        │         │        │        │         │         │         │
│  ❤️ Charity Donation   │   ✅    │   ⚠️   │   ⚠️   │   ✅    │   ⚠️    │   ✅    │
│  👕 Merchandise        │   ⚠️    │   ✅   │   ⚠️   │   ⚠️    │   ⚠️    │   ✅    │
│  🎲 Contest Entries    │   ❌    │   ❌   │   ❌   │   ❌    │   ❌    │   ✅    │
│                        │         │        │        │         │         │         │
│  ──────────────────────┴─────────┴────────┴────────┴─────────┴─────────┴─────────│
│                                                                                    │
│  Legend:  ✅ Excellent fit    ⚠️ Possible but not ideal    ❌ Not recommended     │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

# 6️⃣ Rules & Checks

## Universal Rules (All Campaigns)

| Rule | Description | Configurable |
|------|-------------|--------------|
| **Campaign Status** | Only active campaigns process referrals | No |
| **Campaign Dates** | Start and end dates | Yes |
| **Conversion Window** | How long attribution lasts | Yes (30/60/90 days) |
| **Self-Referral Block** | Cannot refer yourself | No (always blocked) |
| **Duplicate Block** | Same person referred twice | Yes (first/last touch) |

## Fraud Prevention Rules

| Rule | Description | Action |
|------|-------------|--------|
| **Same IP** | Multiple signups from same IP | Flag for review |
| **Same Device** | Device fingerprint match | Flag for review |
| **Velocity** | Too many referrals too fast | Hold rewards |
| **Email Pattern** | Disposable/temp emails | Block or flag |
| **VPN Detection** | Known VPN IP addresses | Flag for review |
| **Same Household** | Same billing address | Flag for review |

## Reward Rules

| Rule | Description | Options |
|------|-------------|---------|
| **Trigger Event** | When reward is earned | Signup, Trial, Purchase |
| **Minimum Purchase** | Required purchase amount | €0+ |
| **Reward Cap Per Referral** | Maximum reward per referral | €X |
| **Total Cap Per Period** | Maximum rewards per month/year | €X |
| **Pending Period** | Hold reward before approval | 0-30 days |
| **Refund Window** | Time during which refund revokes reward | 30-90 days |

## Campaign-Specific Rules

### User Referral Rules

| Rule | Description |
|------|-------------|
| **Referrer Eligibility** | Must be paying customer / Any user / Anyone |
| **Referee Eligibility** | New users only / New to product only |
| **Two-Sided Reward** | Whether referee also gets reward |
| **Referee Reward Type** | What referee receives |

### Waitlist Rules

| Rule | Description |
|------|-------------|
| **Position Boost** | How many positions per referral |
| **Maximum Position** | Cap on how high you can go |
| **Leaderboard Visibility** | Show top referrers publicly |
| **Milestone Thresholds** | At what counts to give bonuses |

### Affiliate Rules

| Rule | Description |
|------|-------------|
| **Application Required** | Must apply to join |
| **Approval Process** | Auto-approve or manual |
| **Minimum Payout** | Threshold for payout |
| **Payment Terms** | Net 15, 30, 60 |
| **Recurring Duration** | How long recurring lasts |
| **Exclusivity** | Can promote competitors |

---

# 7️⃣ Glossary

| Term | Definition |
|------|------------|
| **Actor** | Any person or entity in the referral system |
| **Affiliate** | External partner promoting for commission |
| **Ambassador** | Long-term dedicated brand advocate |
| **Attribution** | Process of crediting a conversion to a referrer |
| **Attribution Window** | Time period during which referral credit is valid |
| **Campaign** | A configured referral program with rules and rewards |
| **Churn** | When a customer or referrer leaves |
| **Click** | When someone clicks a referral link |
| **Client** | A company using your referral platform (your customer) |
| **Conversion** | When a prospect completes the desired action |
| **Conversion Event** | The specific action that triggers a reward |
| **Cookie** | Browser storage for attribution tracking |
| **First-Touch** | Attribution model crediting first referrer |
| **Last-Touch** | Attribution model crediting last referrer |
| **Lead** | A potential customer (prospect) |
| **LTV** | Lifetime Value - total revenue from a customer |
| **MRR** | Monthly Recurring Revenue |
| **One-Sided** | Reward structure where only referrer is rewarded |
| **Payout** | Transferring earned rewards to referrer |
| **Prospect** | Person who clicked referral link but hasn't converted |
| **Referee** | The person being referred (also Referred User) |
| **Referral** | The act of referring someone, or the referred person |
| **Referral Code** | Unique identifier for a referrer (e.g., JOHN-X7K9) |
| **Referral Link** | Unique URL containing referral tracking |
| **Referrer** | Person who refers others |
| **Reward** | What the referrer receives for successful referral |
| **Reward Balance** | Accumulated unpaid rewards |
| **Self-Referral** | Referring yourself (usually blocked) |
| **Tenant** | A client's isolated data space (multi-tenancy) |
| **Two-Sided** | Reward structure where both referrer and referee are rewarded |
| **Widget** | Embeddable UI component for referral program |

---

# 📊 Summary

## MVP Scope

| Category | MVP Included |
|----------|--------------|
| **Campaign Types** | User Referral (one-sided, two-sided) |
| **Reward Types** | Cash (fixed, percentage, recurring), Account Credit, Discount Code |
| **Actors** | Client, Client Admin, Referrer, Prospect, Converted Customer |
| **Attribution** | First-touch (last-touch V1.1) |
| **Account Model** | Embedded only (widget in client's app) |
| **Portal** | Not needed for MVP (widget handles everything) |

## Post-MVP Additions

| Version | Additions |
|---------|-----------|
| **V1.1** | Waitlist campaign, tiered rewards |
| **V1.2** | Affiliate program (requires Portal), Employee referral, Contest |
| **V2** | Partner program, Influencer, Ambassador |

---

# 📋 Portal Features by Referrer Type

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                    │
│  PORTAL FEATURES COMPARISON                                                        │
│                                                                                    │
│                        │Customer│Affiliate│Partner │Influencer│Ambassador│Employee│
│  ──────────────────────┼────────┼─────────┼────────┼──────────┼──────────┼────────│
│  PORTAL TYPE           │ Widget │  Full   │  Full  │   Full   │   Full   │Internal│
│                        │        │         │        │          │          │        │
│  ACCOUNT FEATURES      │        │         │        │          │          │        │
│  ──────────────────────┼────────┼─────────┼────────┼──────────┼──────────┼────────│
│  Login/Account         │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │  SSO   │
│  Application Form      │   ❌   │   ✅    │   ❌   │    ❌    │    ✅    │   ❌   │
│  Team Members          │   ❌   │   ❌    │   ✅   │    ❌    │    ❌    │   ❌   │
│  Profile Settings      │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ⚠️   │
│                        │        │         │        │          │          │        │
│  LINK MANAGEMENT       │        │         │        │          │          │        │
│  ──────────────────────┼────────┼─────────┼────────┼──────────┼──────────┼────────│
│  Referral Link         │   ✅   │   ✅    │   ✅   │    ✅    │    ✅    │   ✅   │
│  Multiple Links        │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│  Discount Codes        │   ⚠️   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│  QR Codes              │   ✅   │   ✅    │   ✅   │    ✅    │    ✅    │   ⚠️   │
│                        │        │         │        │          │          │        │
│  SHARING               │        │         │        │          │          │        │
│  ──────────────────────┼────────┼─────────┼────────┼──────────┼──────────┼────────│
│  Social Sharing        │   ✅   │   ⚠️    │   ❌   │    ✅    │    ✅    │   ✅   │
│  Email Sharing         │   ✅   │   ⚠️    │   ❌   │    ⚠️    │    ⚠️    │   ✅   │
│  WhatsApp/LinkedIn     │   ✅   │   ⚠️    │   ❌   │    ✅    │    ✅    │   ✅   │
│                        │        │         │        │          │          │        │
│  ANALYTICS             │        │         │        │          │          │        │
│  ──────────────────────┼────────┼─────────┼────────┼──────────┼──────────┼────────│
│  Basic Stats           │   ✅   │   ✅    │   ✅   │    ✅    │    ✅    │   ✅   │
│  Detailed Reports      │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ⚠️   │
│  Export Data           │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│  Conversion Tracking   │   ✅   │   ✅    │   ✅   │    ✅    │    ✅    │   ✅   │
│                        │        │         │        │          │          │        │
│  PAYOUTS               │        │         │        │          │          │        │
│  ──────────────────────┼────────┼─────────┼────────┼──────────┼──────────┼────────│
│  View Balance          │   ✅   │   ✅    │   ✅   │    ✅    │    ✅    │   ✅   │
│  Payout Settings       │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│  Request Payout        │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│  Payout History        │   ⚠️   │   ✅    │   ✅   │    ✅    │    ✅    │   ✅   │
│  Tax Forms             │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│                        │        │         │        │          │          │        │
│  RESOURCES             │        │         │        │          │          │        │
│  ──────────────────────┼────────┼─────────┼────────┼──────────┼──────────┼────────│
│  Marketing Materials   │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│  Banners/Creatives     │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ❌   │
│  Email Templates       │   ❌   │   ✅    │   ⚠️   │    ⚠️    │    ⚠️    │   ❌   │
│  Product Info          │   ❌   │   ✅    │   ✅   │    ✅    │    ✅    │   ⚠️   │
│  Training/Docs         │   ❌   │   ⚠️    │   ✅   │    ⚠️    │    ✅    │   ⚠️   │
│                        │        │         │        │          │          │        │
│  SPECIAL FEATURES      │        │         │        │          │          │        │
│  ──────────────────────┼────────┼─────────┼────────┼──────────┼──────────┼────────│
│  Deal Registration     │   ❌   │   ❌    │   ✅   │    ❌    │    ❌    │   ❌   │
│  Lead Management       │   ❌   │   ❌    │   ✅   │    ❌    │    ❌    │   ❌   │
│  Open Positions List   │   ❌   │   ❌    │   ❌   │    ❌    │    ❌    │   ✅   │
│  Candidate Status      │   ❌   │   ❌    │   ❌   │    ❌    │    ❌    │   ✅   │
│  Community Access      │   ❌   │   ❌    │   ⚠️   │    ❌    │    ✅    │   ❌   │
│  Early Access Features │   ❌   │   ❌    │   ⚠️   │    ❌    │    ✅    │   ❌   │
│  Leaderboard           │   ⚠️   │   ⚠️    │   ❌   │    ⚠️    │    ⚠️    │   ⚠️   │
│                        │        │         │        │          │          │        │
│  ──────────────────────┴────────┴─────────┴────────┴──────────┴──────────┴────────│
│                                                                                    │
│  Legend:  ✅ Required    ⚠️ Optional    ❌ Not applicable                          │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

# 📋 Implementation Priority

## What to Build When

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  MVP                                                            │
│  ───                                                            │
│                                                                 │
│  ✅ Customer/User Referral Campaign                             │
│  ✅ Embedded Widget (no separate account/portal)                │
│  ✅ Basic metrics for customer referrers                        │
│  ✅ Cash, Credit, Discount reward types                         │
│                                                                 │
│  Portal: NOT NEEDED                                             │
│  Account Creation: NOT NEEDED                                   │
│  Referrer authenticates via Client's system                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  V1.1 (Months 1-3)                                              │
│  ─────────────────                                              │
│                                                                 │
│  ✅ Waitlist/Viral Campaign                                     │
│  ✅ Tiered Rewards                                              │
│  ⚠️ Basic self-service portal (optional)                        │
│                                                                 │
│  Portal: OPTIONAL (waitlist can work with landing page)         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  V1.2 (Months 4-6)                                              │
│  ─────────────────                                              │
│                                                                 │
│  ✅ Affiliate Program                                           │
│  ✅ Employee Referral                                           │
│  ✅ Contest/Sweepstakes                                         │
│                                                                 │
│  Portal: REQUIRED for Affiliates                                │
│  ─────────────────────────────────                              │
│  • Application system                                           │
│  • Affiliate account creation                                   │
│  • Full affiliate dashboard                                     │
│  • Payout settings                                              │
│  • Marketing materials                                          │
│                                                                 │
│  Employee Portal: SSO Integration                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  V2 (Months 7-12)                                               │
│  ────────────────                                               │
│                                                                 │
│  ✅ Partner/Reseller Program                                    │
│  ✅ Influencer Program                                          │
│  ✅ Ambassador Program                                          │
│                                                                 │
│  Portal Enhancements:                                           │
│  ─────────────────────                                          │
│  • Company accounts (team members)                              │
│  • Deal registration                                            │
│  • Advanced reporting                                           │
│  • MDF management                                               │
│  • Training/certification                                       │
│  • Community features                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

**Document Version:** 1.0  
**Created:** December 2024  
**Author:** Product Team  
**Next Review:** Before MVP development
