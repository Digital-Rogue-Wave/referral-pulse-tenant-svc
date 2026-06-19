# Referral Revenue OS — Complete Product Specification

**Platform Codename:** Referral Revenue OS  
**Document Version:** 3.2  
**Status:** Implementation-Ready Specification  
**Target Launch:** December 2026  
**Initial Markets:** Germany, France, Spain (EU-first)

---

## Document Purpose

This documentation defines the complete product architecture, domain model, actor specifications, and system behaviors for an AI-first, API-first referral marketing SaaS platform.

---

## Key Constraints

1. **Participants have NO platform access** — All interactions via links, widgets, emails, magic links
2. **EU-first compliance** — GDPR, data residency, consent management are core features
3. **API-first architecture** — UI consumes same APIs as customers
4. **AI with human control** — Recommendations require acceptance; decisions have guardrails

---

## Table of Contents

1. [Product Context](#1-product-context)
2. [Core Concepts & Glossary](#2-core-concepts--glossary)
3. [Domain Architecture](#3-domain-architecture)
4. [Actors](#4-actors)
5. [Segmentation & Eligibility](#5-segmentation--eligibility)
6. [Campaigns & Pulses](#6-campaigns--pulses)
7. [Participants & Trust Model](#7-participants--trust-model)
8. [Rewards](#8-rewards)
9. [Tracking & SDK](#9-tracking--sdk)
10. [Attribution](#10-attribution)
11. [AI Features](#11-ai-features)

---


# 1. Product Context

## Target Segments

| Segment | Description | Priority |
|---------|-------------|----------|
| **B2B SaaS** | Software-as-a-service companies | Primary |
| **Agencies** | Professional services, consultancies | Secondary |
| **Creators** | Memberships, courses, communities | Secondary |
| **AI Tools** | AI-powered applications and APIs | Primary |

## Geography

- **Initial Launch:** Germany, France, Spain
- **Expansion:** EU markets
- **Compliance:** GDPR-native, EU data residency

## Strategic Differentiators

| Differentiator | Description |
|----------------|-------------|
| **Vertical Playbooks** | Pre-configured bundles for specific business types |
| **Revenue-First Analytics** | MRR/ARR attribution, not just signup counting |
| **EU-First Compliance** | GDPR, consent, data residency as core features |
| **Fraud Protection by Design** | Built-in fraud detection at every stage |
| **AI-Embedded Operations** | AI in core flows, not bolted on as chatbot |

## Technical Stack (Immutable)

| Component | Technology |
|-----------|------------|
| Services | NestJS microservices |
| Frontend | React dashboard |
| Database | AWS RDS (per service) |
| Analytics DB | ClickHouse |
| Auth | Ory (AuthN/AuthZ) |
| Workflows | Temporal |
| Cache/Queue | Redis ElastiCache |
| Storage | S3 |
| Observability | OpenTelemetry + Prometheus + Grafana |

---


# 2. Core Concepts & Glossary

## Primary Entities

| Entity | Definition |
|--------|------------|
| **Program** | Top-level container representing a client's entire referral operation. One program per client. |
| **Campaign** | A discrete referral initiative with specific goals, schedule, pulse type, and budget. Contains variants. |
| **Variant** | Segment-specific configuration within a campaign. Each variant has its own rewards, messaging, and eligibility rules. |
| **Pulse** | A workflow template that defines trigger logic (e.g., Signup Pulse triggers on account creation, Conversion Pulse triggers on payment). |
| **Playbook** | A vertical-specific configuration bundle combining recommended Pulses, rewards, and settings. |
| **Participant** | An external actor who refers others. NO platform access — interacts only via links, widgets, emails. |
| **Referee** | A person who is referred by a participant and becomes a customer. |
| **Referral** | The tracked relationship between a participant (referrer) and referee (referred). |
| **Segment** | A defined group of participants based on attributes, behavior, or random assignment. |
| **Reward** | The incentive granted to participants (and optionally referees) for successful referrals. |
| **Touch** | A recorded interaction in the referral journey (click, share, visit, email open). |
| **Attribution** | The process of assigning credit for a conversion to the correct participant(s). |
| **Enrollment Model** | Campaign-level setting that determines how participants are registered: "open" (client enrolls all users) or "selective" (client enrolls specific users only). |
| **Default Variant** | Auto-created variant that every campaign has. If client defines no variants, the default variant holds the campaign's reward/messaging config. Acts as catch-all fallback in multi-variant campaigns. |

## Entity Hierarchy

```
Program (1 per client)
│
└── Campaign
    ├── pulse_type (shared)      ← Trigger logic same for all variants
    ├── schedule (shared)        ← Start/end dates
    ├── budget (shared)          ← Total budget cap
    ├── enrollment_model         ← "open" or "selective"
    │
    ├── Variant A
    │   ├── segment              ← Who qualifies
    │   ├── reward_config        ← Variant-specific rewards
    │   ├── messaging            ← Variant-specific copy
    │   └── eligibility_rules    ← Additional rules (optional)
    │
    └── Variant B
        ├── segment
        ├── reward_config        ← Different rewards
        ├── messaging            ← Different copy
        └── eligibility_rules
```

**Key Design Decisions:**

1. Reward configuration is at the **Variant** level, not Campaign level. This enables segment-specific incentives within a single campaign.
2. Every campaign always has at least one variant — the **Default Variant**. If the client creates a simple campaign without defining variants, the system auto-creates a default variant holding the campaign's reward and messaging config. In multi-variant campaigns, one variant can be marked as default to serve as a catch-all for participants who don't match any segment.
3. **Enrollment Model** is at the Campaign level. "Open" means the client intends to enroll all their users as participants. "Selective" means the client enrolls specific users only. In both cases, the client must register users in our platform — the difference is in the client's strategy, not in our system behavior.

## What Lives Where

| Config | Level | Rationale |
|--------|-------|-----------|
| Pulse type | Campaign | Same trigger logic for all variants |
| Schedule | Campaign | Unified start/end |
| Budget | Campaign | Shared budget pool |
| Enrollment model | Campaign | Client's enrollment strategy applies to all variants |
| Segment target | Variant | Different audiences |
| Reward config | Variant | Different incentives per segment |
| Messaging | Variant | Personalized copy |
| Eligibility rules | Variant | Segment-specific requirements |

## Lifecycle States

### Campaign States
`Draft` → `Scheduled` → `Active` → `Paused` → `Ended` → `Archived`

### Participant States
`Candidate` → `Active` → `Dormant` → `Reactivated` | `Suspended` | `Banned`

### Referral States
`Pending` → `Qualified` → `Converted` → `Rewarded` | `Expired` | `Rejected`

### Reward States
`Pending` → `Approved` → `Processing` → `Paid` | `Rejected` | `Reversed`

---


# 3. Domain Architecture

## Domain Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REFERRAL REVENUE OS                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Identity   │  │  Program &  │  │ Segmenta-  │  │  Referral   │    │
│  │  & Access   │  │  Campaign   │  │   tion     │  │  Tracking   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Rewards &  │  │ Analytics & │  │    AI &    │  │ Compliance  │    │
│  │  Payouts    │  │ Attribution │  │Optimization│  │  & Privacy  │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Integrations & APIs                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Domain Responsibilities

| Domain | Primary Responsibilities |
|--------|-------------------------|
| **Identity & Access** | User authentication, authorization, roles, API keys |
| **Program & Campaign** | Program lifecycle, campaign CRUD, variant management, playbooks |
| **Segmentation** | Segment definition, membership, random assignment (traffic splitting) |
| **Referral Tracking** | Touch capture, link management, SDK events, cookie handling |
| **Rewards & Payouts** | Reward calculation, approval workflows, payout processing |
| **Analytics & Attribution** | Attribution models, conversion tracking, reporting |
| **AI & Optimization** | Setup assistant, widget generation, fraud ML, incentive optimization |
| **Compliance & Privacy** | GDPR, consent management, data retention, audit logs |
| **Integrations & APIs** | Public API, webhooks, third-party connectors |

## Referral Tracking: Touch Capture Explained

**Touch** = Any tracked interaction between referral link click and conversion.

**Touch Capture** = The process of recording these interactions with full context.

| Touch Type | How Captured | Data Recorded |
|------------|--------------|---------------|
| **Click** | SDK detects `?ref=` parameter | ref_code, timestamp, referrer URL, UTMs, device, IP hash |
| **Share** | SDK tracks share button clicks | channel (LinkedIn, email, copy), timestamp, link variant |
| **Widget View** | SDK tracks widget render | page URL, duration, variant shown |
| **Page Visit** | SDK pageview tracking | URL path, referrer, session_id, time on page |
| **Email Open** | Tracking pixel in platform-sent email | invitation_id, timestamp, email client |
| **Email Click** | Redirect through tracking URL | link_id, timestamp, destination |

**Why Touch Capture Matters:**

1. **Attribution chain** — Determines which participant gets credit
2. **Multi-touch attribution** — Enables credit splitting (V2)
3. **Channel analytics** — Which channels convert best
4. **Fraud detection** — Suspicious timing/pattern detection
5. **Funnel analysis** — Where referrals drop off

---


# 4. Actors

## Actor Taxonomy

```
                           ACTORS
    ┌──────────────────────┴──────────────────────┐
    │                                             │
 INTERNAL                                     EXTERNAL
(Platform Access)                          (No Platform Access)
    │                                             │
    ├── Super Admin                               ├── Participant
    ├── Program Admin                             └── Referee
    ├── Campaign Manager
    ├── Analyst
    └── Support Agent
```

## Internal Actors (Platform Users)

| Actor | Access Level | Key Capabilities |
|-------|--------------|------------------|
| **Super Admin** | Full | Multi-tenant management, billing, system config |
| **Program Admin** | Program | All program settings, API keys, integrations |
| **Campaign Manager** | Campaigns | Create/edit campaigns, approve rewards |
| **Analyst** | Read-only | View analytics, export data |
| **Support Agent** | Limited write | View participant data, manual adjustments |

## External Actors (No Platform Access)

### Participant (Referrer)

**Critical Constraint:** Participants have NO platform login. All interactions via:
- Referral links (unique per participant)
- Embedded widgets (in client's app)
- Email notifications (rewards, conversions)
- Magic links (for payout setup)
- QR codes (for offline/events)

**Participant Capabilities:**
- View their referral link and stats (via widget)
- Share via social/email/copy
- See pending and earned rewards
- Set up payout method (via magic link)
- View referral history

### Referee (Referred Person)

**Definition:** Person who clicks a referral link and potentially converts.

**Lifecycle:**
1. Anonymous visitor (clicked link, has cookie)
2. Lead (provided email or signed up)
3. Customer (completed qualifying action — payment, subscription)

**Referee Capabilities:**
- Click referral links
- Receive referee rewards (if two-sided rewards configured)
- No direct platform interaction

---


# 5. Segmentation & Eligibility

## Segment Types

| Type | Description | Example | Update Frequency |
|------|-------------|---------|------------------|
| **Static** | Manually curated list | "Beta testers", "VIPs" | Manual |
| **Rule-Based** | Attribute filters | plan = "enterprise" AND mrr > 500 | Real-time |
| **AI-Generated** | ML clustering | "High engagement cluster" | Daily batch |
| **Predictive** | Propensity scoring | "Likely to refer" score > 70 | Daily batch |
| **Random** | Random assignment (traffic splitting) | 50% split for reward testing | On assignment |

## Random Segments (Traffic Splitting)

**Key Insight:** Traffic splitting between variants uses random segment allocation. No separate testing framework needed. Random segments are simply one segment type — they need zero data about the participant.

```yaml
segment:
  name: "reward_test_control"
  type: random
  assignment:
    percentage: 50
    seed: "campaign_123_2024"   # Deterministic randomization
    sticky: true                 # User stays in same group
    mutual_exclusion_group: "reward_test"  # Can't be in both test groups
```

### Random Segment Properties

| Property | Type | Description |
|----------|------|-------------|
| `percentage` | 1-100 | % of eligible users assigned |
| `seed` | string | Deterministic seed for reproducibility |
| `sticky` | boolean | User stays in same segment across sessions |
| `mutual_exclusion_group` | string | Segments that cannot overlap |

### Traffic Split Example

```
Campaign: "Q1 Reward Test"
├── Variant A → Segment: "random_control" (50%) → €25 reward
└── Variant B → Segment: "random_variant" (50%) → €50 reward

After 30 days: Compare conversion rates, decide winner
```

## Variant Resolution Timing

**Critical Architectural Decision:** Variant resolution happens at **participant enrollment** (link generation time), NOT at referee click.

```
Participant enrolls
  → Platform evaluates their data against variant segments
  → Variant assigned
  → Link generated for THAT variant
  → All referees from this link land in the same variant
```

**Why at enrollment, not at click:**

| Concern | At Enrollment (correct) | At Click (rejected) |
|---------|------------------------|---------------------|
| Participant messaging | Widget shows "Share and earn €50" — knows variant | Widget says "Share and earn..." what? Unknown reward |
| Reward consistency | All referrals from this participant get same reward rules | Same participant, different rewards per referee — confusing |
| Email content | Reward amount/type in confirmation email | Vague email — can't promise specific reward |
| Magic link portal | Shows consistent reward info | Shows "varies" — poor experience |
| Trust | Participant knows exactly what they're offering | Participant can't make a clear promise |

**The referrer experience demands it.** A participant who sees "Share and earn €50" must reliably earn €50 per qualified referral.

### Variant Allocation Fallback Chain

```
Participant enrolled with attributes
  ↓
Evaluate against each variant's segment (in priority order)
  ↓
MATCH FOUND (one variant)     → Assign directly
MATCH FOUND (multiple)        → Random allocation by weight among matching
NO MATCH + default variant    → Assign default variant
NO MATCH + no default variant → Ineligible (no link generated)
```

For simple campaigns (one variant = the default): no evaluation needed — every participant gets the same variant.

## Rule-Based Segment Syntax

```yaml
segment:
  name: "High-Value Enterprise DE"
  type: rule_based
  rules:
    AND:
      - field: mrr
        operator: ">="
        value: 500
      - field: plan
        operator: "in"
        value: ["enterprise", "enterprise_plus"]
      - field: country
        operator: "="
        value: "DE"
  evaluation: real_time
```

## Eligibility Checkpoints

| Checkpoint | When Evaluated | What It Blocks |
|------------|----------------|----------------|
| **Entry** | Participant joins campaign | Campaign access |
| **Referral** | Creating a new referral | Referral creation |
| **Conversion** | Referee converts | Credit assignment |
| **Reward** | Reward calculation | Reward issuance |
| **Payout** | Requesting payout | Payout processing |

---


# 6. Campaigns & Pulses

## Campaign → Variant → Segment Model

```
Campaign: "Q1 Growth Push"
│
├── Shared Config (Campaign Level):
│   ├── pulse_type: conversion       ← All variants trigger on payment
│   ├── start_date: 2025-01-01
│   ├── end_date: 2025-03-31
│   ├── budget: €10,000
│   └── attribution_window: 90 days
│
├── Variant: "Enterprise" (priority: 1)
│   ├── segment: "enterprise_customers"
│   ├── participant_reward: €100 cash
│   ├── referee_reward: €50 credit
│   ├── messaging:
│   │   ├── headline: "Refer enterprise partners"
│   │   └── description: "Earn €100 for each conversion"
│   └── eligibility: mrr >= 1000
│
├── Variant: "SMB" (priority: 2)
│   ├── segment: "smb_customers"
│   ├── participant_reward: €25 cash
│   ├── referee_reward: none
│   └── messaging:
│       ├── headline: "Share and earn"
│       └── description: "Get €25 for referrals"
│
└── Variant: "Test Group" (priority: 3)
    ├── segment: "random_test_20%"
    ├── participant_reward: €150 cash
    └── messaging:
        ├── headline: "Limited time: 3x rewards!"
        └── description: "Earn €150 per referral"
```

**Variant Matching:** Participant matches **first** variant whose segment they belong to (priority order).

## Campaign Creation Sources

| Source | Description | When to Use |
|--------|-------------|-------------|
| **AI Assistant** | Analyzes website, generates campaign config | New clients, optimization |
| **Playbook** | Pre-built vertical templates | Quick start, proven patterns |
| **Manual** | Operator creates from scratch | Custom requirements |

**Note:** AI may use Playbooks as starting points and customize based on website analysis.

## Campaign State Machine

```
     ┌──────────────────────────────────────────┐
     │                                          │
     ▼                                          │
┌─────────┐     ┌───────────┐     ┌──────────┐  │
│  Draft  │────►│ Scheduled │────►│  Active  │──┤
└─────────┘     └───────────┘     └────┬─────┘  │
                                       │        │
                     ┌─────────────────┼────────┘
                     │                 │
                     ▼                 ▼
               ┌──────────┐     ┌──────────┐
               │  Paused  │◄───►│  Active  │
               └──────────┘     └────┬─────┘
                                     │
                                     ▼
                               ┌──────────┐     ┌──────────┐
                               │  Ended   │────►│ Archived │
                               └──────────┘     └──────────┘
```

## Pulse Types (Workflow Templates)

| Pulse | Trigger Event | Typical Use Case |
|-------|---------------|------------------|
| **Signup** | Referee creates account | Lead generation, newsletters |
| **Conversion** | Referee makes first payment | Revenue-focused SaaS |
| **Reactivation** | Churned user returns and pays | Win-back campaigns |
| **Cross-Sell** | Existing user buys new product | Product expansion |
| **Renewal** | Subscription renews | Retention campaigns |
| **Feedback** | Referee leaves verified review | Social proof (G2, Capterra) |
| **Newsletter** | Email subscription confirmed | Content marketing |
| **Switch-Up** | Competitor's customer converts | Competitive displacement |
| **Product Education** | User completes onboarding milestone | Activation campaigns |

## Playbook Templates

| Playbook | Vertical | Default Pulse | Typical Reward Structure |
|----------|----------|---------------|-------------------------|
| **SaaS Growth** | B2B SaaS | Conversion | % of first year revenue |
| **Agency Partner** | Agencies | Conversion | Commission tiers + recurring |
| **Creator Economy** | Creators | Signup | Fixed per signup |
| **AI Tools** | AI/Dev Tools | Conversion | Usage credits |

---


# 7. Participants & Trust Model

## How Clients Register Participants (Referrer Enrollment)

Participants are the client's own users. The client decides who becomes a participant and when. Our platform provides tools for the client to register their users — we don't acquire participants ourselves.

**Key distinction:**
- **Enrollment** = registering a user as a participant (getting them a link) — client pushes users into our platform
- **Sharing** = an enrolled participant using their link to bring referees — widget, email, social, etc.

Widgets, email templates, and landing pages are **sharing tools** for already-enrolled participants, NOT enrollment mechanisms.

### Enrollment Methods

**Proactive (client pushes users) — for campaign seeding & launches:**

| Method | How | Who Uses It | Phase |
|--------|-----|-------------|-------|
| **API Single** | `POST /v1/referrers` + `POST /v1/referrers/{id}/links` | Client backend (triggered by business logic) | MVP |
| **API Bulk** | `POST /v1/referrers/batch` (up to 1000 per request) | Client backend (campaign launch) | MVP |
| **CSV Import** | Upload file via dashboard, map columns, preview, import | Marketer/operator (no engineering) | Lot 1 |
| **CRM Connector** | Connect HubSpot/Salesforce, select list, enroll contacts | Marketer/operator (no engineering) | Lot 1 |
| **Auto-Enrollment Rules** | "When event X occurs → enroll in campaign Y" | Configured in dashboard, triggered by events | Lot 1 |

**Reactive (user acts) — for ongoing organic growth:**

| Method | How | Who Uses It | Phase |
|--------|-----|-------------|-------|
| **SDK Widget** | Logged-in user engages with "Refer a Friend" widget in client's product | End user (self-service) | MVP |

### Typical Launch Scenario

```
EXISTING USERS (campaign launch):
  Client exports "paying customers > 90 days" from their database or CRM
  → Uploads CSV in dashboard (marketer) OR calls bulk API (engineering)
  → 2,000 participants enrolled, each gets a variant + link
  → Platform sends enrollment emails (or client sends their own)

NEW USERS (ongoing):
  Auto-enrollment rule: "On payment.completed where is_first_payment = true → enroll"
  → Every new paying customer automatically becomes a participant
  
  Or: User encounters SDK widget in client's product → self-enrolls
```

### What Happens After Enrollment

Enrollment alone is not enough — the participant needs to receive their link and be activated.

| Channel | How | When |
|---------|-----|------|
| **Enrollment email** | Platform sends email with referral link + reward info + sharing tools | Immediately after enrollment (configurable) |
| **SDK widget** | Next time user visits client's product, widget shows their link | On next page load (SDK detects enrolled participant) |
| **Client's own email** | Client sends their own email using the link from API response | Client controls timing |
| **Magic link portal** | Participant can view stats via magic link in email | On demand |

## Participant Lifecycle

```
    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │   ┌───────────┐      ┌───────────┐      ┌───────────┐          │
    │   │ Candidate │─────►│  Active   │─────►│  Dormant  │          │
    │   └───────────┘      └─────┬─────┘      └─────┬─────┘          │
    │                            │                  │                 │
    │                            │                  ▼                 │
    │                            │            ┌───────────┐          │
    │                            │            │Reactivated│          │
    │                            │            └───────────┘          │
    │                            ▼                                    │
    │                      ┌───────────┐                              │
    │                      │  Flagged  │ ◄── Fraud signals detected  │
    │                      └─────┬─────┘                              │
    │                            │                                    │
    │                            ▼                                    │
    │                      ┌───────────┐                              │
    │                      │ Suspended │ ◄── Under investigation     │
    │                      └─────┬─────┘                              │
    │                            │                                    │
    │                            ▼                                    │
    │                      ┌───────────┐                              │
    │                      │  Banned   │ ◄── Permanent block         │
    │                      └───────────┘                              │
    └─────────────────────────────────────────────────────────────────┘
```

## Participant States

| State | Description | Can Refer? | Can Earn? |
|-------|-------------|------------|-----------|
| **Candidate** | Identified but not yet active | No | No |
| **Active** | Actively participating | Yes | Yes |
| **Dormant** | No activity for 90+ days | Yes | Yes |
| **Flagged** | Under fraud review | Yes | Held |
| **Suspended** | Temporarily blocked | No | Held |
| **Banned** | Permanently blocked | No | Forfeited |

---

## Trust Model

### What Is It?

The Trust Model is a **cumulative reputation system for participants**. It determines privileges, limits, and processing speed based on long-term behavior.

**Applies to:** Participants only (not referees, not campaigns)

### Trust Score Components

| Component | Weight | Description |
|-----------|--------|-------------|
| **Account Age** | 15% | Time since first referral |
| **Success Rate** | 25% | % of referrals that convert |
| **Conversion Quality** | 20% | LTV of referred customers |
| **Fraud Incidents** | 25% | Historical fraud flags (negative) |
| **Verification** | 15% | Email, phone, ID verified |

### Trust Levels

| Level | Score Range | Privileges |
|-------|-------------|------------|
| **New** | 0-25 | €100/month payout limit, 14-day hold, manual review |
| **Established** | 26-50 | €500/month limit, 7-day hold, standard processing |
| **Trusted** | 51-75 | €2,000/month limit, 3-day hold, priority processing |
| **Advocate** | 76-100 | €10,000/month limit, instant payouts, auto-approval |

### Trust Level Effects

| Effect | New | Established | Trusted | Advocate |
|--------|-----|-------------|---------|----------|
| Monthly payout limit | €100 | €500 | €2,000 | €10,000 |
| Payout hold period | 14 days | 7 days | 3 days | Instant |
| Reward approval | Manual | Auto < €50 | Auto < €200 | Auto all |
| Fraud check depth | Full | Standard | Light | Minimal |
| Support priority | Normal | Normal | Priority | VIP |

---

## Trust Model vs Fraud Detection

These are **related but distinct** systems:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   FRAUD DETECTION                    TRUST MODEL                    │
│   ─────────────────                  ───────────                    │
│                                                                     │
│   Scope: Per-event, per-referral     Scope: Per-participant         │
│   Question: "Is THIS suspicious?"    Question: "Is THIS PERSON      │
│                                       trustworthy overall?"         │
│                                                                     │
│   Output: Risk score (0.0-1.0)       Output: Trust score (0-100)   │
│   Timing: Real-time                  Timing: Cumulative            │
│   Action: Block/flag referral        Action: Set privileges        │
│                                                                     │
│                    ┌─────────────────────┐                          │
│                    │                     │                          │
│   Fraud Incident ─►│  Trust Score Update │◄── Time + Success       │
│   (negative)       │                     │    (positive)            │
│                    └─────────────────────┘                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### How They Interact

| Scenario | Fraud Detection | Trust Model Impact |
|----------|-----------------|-------------------|
| New participant, first referral | Full fraud check | Starts at score 0 |
| Referral passes checks | Low risk → approve | Score gradually increases |
| Suspicious pattern detected | Flag referral | Score decreases |
| Confirmed fraud | Block + alert | Major score penalty |
| Consistent quality over time | Lighter checks | Higher trust level |
| High-trust participant | Minimal checks | Auto-approval privileges |

---

## Fraud Detection

### Fraud Signals

| Signal | Severity | Description |
|--------|----------|-------------|
| **Self-referral** | High | Same email, IP, or device fingerprint |
| **Velocity abuse** | Medium | Too many referrals too fast |
| **Disposable email** | Medium | Temporary email domains (mailinator, etc.) |
| **VPN/proxy** | Low | Masked IP address |
| **Device fingerprint match** | High | Same device, different accounts |
| **Payment reversal** | High | Chargebacks, refunds after reward |
| **Geographic mismatch** | Medium | IP location doesn't match profile |
| **Bot patterns** | High | Non-human interaction patterns |

### Fraud Checkpoints

| Checkpoint | Signals Evaluated | Auto-Block Threshold |
|------------|-------------------|---------------------|
| **Referral creation** | Self-referral, velocity, device | Score > 0.8 |
| **Qualification** | Conversion timing, device, geo | Score > 0.7 |
| **Reward approval** | Historical patterns, LTV | Score > 0.7 |
| **Payout** | Accumulated signals, account age | Score > 0.6 |

### Fraud Score Actions

| Score Range | Action |
|-------------|--------|
| 0.0 - 0.3 | Auto-approve |
| 0.3 - 0.7 | Manual review required |
| 0.7 - 1.0 | Auto-block + alert |

---


# 8. Rewards

## Reward Configuration Level

**Important:** Reward configuration is at the **Variant** level, not Campaign level.

```yaml
campaign:
  name: "Q1 Growth"
  pulse_type: conversion    # Shared
  
  variants:
    - name: "Enterprise"
      segment: "enterprise"
      rewards:                # Variant-specific
        participant:
          type: cash
          amount: 100
          currency: EUR
        referee:
          type: account_credit
          amount: 50
          
    - name: "SMB"
      segment: "smb"
      rewards:                # Different rewards
        participant:
          type: cash
          amount: 25
          currency: EUR
        referee: null         # No referee reward
```

## Reward Types

### Monetary Rewards

| Type | Description | Payout Method |
|------|-------------|---------------|
| **Cash** | Direct money transfer | PayPal, Wise, SEPA |
| **Gift Card** | Retail gift cards | Amazon, iTunes, etc. |

### Non-Monetary Rewards

| Type | Description | Fulfillment |
|------|-------------|-------------|
| **Account Credit** | Credit on customer's account | API to client system |
| **Feature Unlock** | Access to premium features | API to client system |
| **Extended Trial** | Additional trial period | API to client system |
| **Discount Code** | % or fixed discount | Code generation |
| **Custom** | Client-defined reward | Webhook notification |

## Reward Structures

| Structure | Description | Example |
|-----------|-------------|---------|
| **Fixed** | Same amount per conversion | €25 per signup |
| **Percentage** | % of transaction value | 20% of first payment |
| **Tiered** | Increases with volume | €25 (1-5), €35 (6-10), €50 (11+) |
| **Recurring** | Commission on renewals | 10% for 12 months |
| **Milestone** | Bonus at thresholds | +€100 at 10 referrals |
| **Capped** | Up to maximum amount | 20% capped at €500 |

## Two-Sided Rewards

Both participant AND referee can receive rewards:

```
Referral Conversion
       │
       ├──► Participant Reward: €50 cash
       │    (referrer gets money)
       │
       └──► Referee Reward: €25 account credit
            (new customer gets credit)
```

## Reward Lifecycle

```
    Conversion Event
           │
           ▼
    ┌──────────────┐
    │   Pending    │ ◄── Awaiting fraud check / approval
    └──────┬───────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
┌─────────┐ ┌─────────┐
│Approved │ │Rejected │ ◄── Fraud, ineligible, etc.
└────┬────┘ └─────────┘
     │
     ▼
┌──────────────┐
│  Processing  │ ◄── Payout initiated
└──────┬───────┘
       │
       ▼
┌──────────────┐
│     Paid     │ ◄── Money transferred
└──────────────┘

(Approved rewards can be Reversed if refund/chargeback occurs)
```

## Payout Methods

| Method | Currencies | Min Payout | Processing Time |
|--------|------------|------------|-----------------|
| **PayPal** | EUR, USD, GBP | €10 | 1-2 business days |
| **Wise** | EUR, USD, GBP + 50 more | €25 | 1-3 business days |
| **SEPA** | EUR | €50 | 2-4 business days |
| **Gift Card** | N/A | €10 | Instant (digital) |

## Tax Compliance & Reporting

### When Is Tax Relevant?

Referral rewards are taxable income for participants. Platform responsibilities vary by jurisdiction:

| Jurisdiction | Threshold | Form Required | Withholding |
|--------------|-----------|---------------|-------------|
| **USA** | $600/year per participant | 1099-MISC | No (unless backup withholding) |
| **Germany** | €0 (all income taxable) | None from platform | No |
| **France** | €0 (all income taxable) | None from platform | No |
| **EU (general)** | Varies by country | None from platform | No |

### Platform Responsibilities

| Task | USA | EU (DACH, France) |
|------|-----|-------------------|
| **Collect tax info** | W-9 before $600 threshold | Not required |
| **Report to authorities** | File 1099-MISC if ≥$600 | Not required |
| **Withhold taxes** | Only if W-9 not provided (24% backup) | Not required |
| **Inform participants** | Yes (annual summary) | Yes (annual summary) |

### Tax Calculation: When and How

```
┌─────────────────────────────────────────────────────────────────┐
│                    TAX HANDLING FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. REWARD APPROVED                                             │
│     └── Gross amount: €100                                      │
│                                                                 │
│  2. TAX CALCULATION (at payout request, not before)             │
│     ├── Check participant jurisdiction                          │
│     ├── Check if W-9 on file (USA only)                         │
│     └── Apply withholding if required                           │
│                                                                 │
│  3. PAYOUT PROCESSING                                           │
│     ├── USA (W-9 on file): Pay €100, report on 1099             │
│     ├── USA (no W-9): Withhold 24% → Pay €76, remit €24 to IRS  │
│     └── EU: Pay €100, no withholding                            │
│                                                                 │
│  4. YEAR-END REPORTING                                          │
│     ├── USA: Generate 1099-MISC for participants ≥$600          │
│     ├── USA: File with IRS by January 31                        │
│     └── EU: Provide annual earnings summary to participant      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### What Platform Does NOT Do

- ❌ Calculate participant's personal tax liability
- ❌ Provide tax advice
- ❌ Handle VAT (rewards are not services, no VAT applies)
- ❌ File taxes on behalf of participants

### Participant Tax Collection (USA)

| Scenario | Platform Action |
|----------|-----------------|
| Participant approaches $500 | Prompt to submit W-9 |
| Participant at $600 without W-9 | Block further payouts until W-9 submitted |
| W-9 submitted | Allow unlimited payouts, report on 1099 |
| W-9 not submitted | Option: 24% backup withholding |

### EU Participant Handling

No platform withholding required. Participants are responsible for declaring income. Platform provides:
- Annual earnings statement (PDF)
- Transaction history export
- Receipt for each payout

---


# 9. Tracking & SDK

## SDK Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CLIENT APPLICATION                               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                     RefRev SDK                                │  │
│  │                                                              │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │  │
│  │  │   Widget    │  │  Tracking   │  │  Identity   │          │  │
│  │  │  Renderer   │  │   Engine    │  │   Manager   │          │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │  │
│  │         │                │                │                  │  │
│  │         └────────────────┼────────────────┘                  │  │
│  │                          │                                    │  │
│  │                   ┌──────▼──────┐                             │  │
│  │                   │ Event Queue │                             │  │
│  │                   │  + Storage  │                             │  │
│  │                   └──────┬──────┘                             │  │
│  │                          │                                    │  │
│  └──────────────────────────┼────────────────────────────────────┘  │
│                             │                                       │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Platform API │
                       └──────────────┘
```

## SDK Integration (Vanilla JavaScript Only)

### Installation

```html
<script>
(function(r,e,f){
  r.RefRevSettings = { apiKey: 'pk_live_xxx' };
  var s = e.createElement('script');
  s.async = 1;
  s.src = 'https://sdk.refrev.io/v1/refrev.js';
  e.head.appendChild(s);
})(window, document);
</script>
```

### Core Methods

```javascript
// 1. Initialize with user identity (MANDATORY for widget to work)
RefRev.init({ 
  apiKey: 'pk_live_xxx',
  campaignId: 'camp_q1_growth',
  consent: 'granted',            // 'granted' | 'denied' | 'pending'
  userId: currentUser.id         // Client's internal user ID (required for widget)
});

// 2. Get attribution (for passing to your backend)
const attribution = RefRev.getAttribution();
// Returns: { ref_code, click_id, session_id } or null

// 3. Show widget (rendered based on enrollment status)
RefRev.showWidget({ 
  mode: 'inline',        // 'inline' | 'modal' | 'floating'
  container: '#widget'   // CSS selector (for inline mode)
});

// 4. Track custom events
RefRev.track('plan_upgraded', { new_plan: 'enterprise' });

// 5. Update consent
RefRev.setConsent('granted');  // After user accepts cookies
```

---

## Widget Visibility & User Identity

### Why userId is Mandatory

The widget must know which user is viewing the page to determine what to show. Without `userId`, the SDK cannot check enrollment status. The client's app always knows who the current user is — `userId` is a single field.

**If userId is NOT provided:**
- Widget does NOT render
- Referee tracking still works (link clicks, cookies)
- Console warning: `"[RefRev] Widget disabled: userId not provided. Pass userId to enable the referral widget."`
- Integration health dashboard flags: "SDK loaded X times without userId"

### How the Widget Determines What to Show

On init, the SDK calls: `GET /v1/widget/config?campaign_id=xxx&user_id=xxx`

The platform checks enrollment status and returns the right widget behavior:

| User Status | Widget Behavior |
|-------------|----------------|
| Enrolled participant for this campaign | Show referral link, sharing tools, stats |
| Not enrolled, but campaign is "open" | Show enrollment CTA ("Start Referring!") — self-enrollment |
| Not enrolled, campaign is "selective" | **Hidden.** Widget not rendered. User doesn't know it exists. |
| Enrolled but blocked/suspended | Hidden |

### Widget Config Response Examples

**Enrolled participant:**
```json
{
  "status": "enrolled",
  "referrer_id": "ref_abc",
  "variant_id": "var_a_enterprise",
  "referral_link": "https://ref.acme.com/r/ALICE123",
  "widget_config": {
    "mode": "active_referrer",
    "headline": "Share and earn €50 per referral",
    "share_message": "Try Acme — use my link for 20% off!",
    "show_stats": true,
    "stats": {
      "referrals_sent": 3,
      "conversions": 1,
      "rewards_earned": "€50"
    }
  }
}
```

**Not enrolled, selective campaign:**
```json
{
  "status": "not_enrolled",
  "enrollment_model": "selective",
  "widget_config": {
    "mode": "hidden"
  }
}
```

**Not enrolled, open campaign (self-enrollment available):**
```json
{
  "status": "not_enrolled",
  "enrollment_model": "open",
  "widget_config": {
    "mode": "enrollment_cta",
    "headline": "Love Acme? Refer friends and earn rewards!",
    "cta_text": "Start Referring",
    "reward_preview": "Earn €15 for every friend who signs up"
  }
}
```

When the user clicks the CTA in "open" mode, the SDK calls `POST /v1/widget/enroll`, registers the user as a participant, resolves variant, generates link, and switches the widget to "active_referrer" mode.

> **Note:** Even in "open" campaigns, users must still be registered in our platform to be participants. The difference is that in "open" mode, self-enrollment via widget is allowed. In "selective" mode, only pre-enrolled users (via API, CSV, CRM, or auto-rules) see the widget.

### Comparison with Competitors

| Platform | Identify Method | How It Works |
|----------|-----------------|--------------|
| **Cello** | JWT token (server-generated) | Server creates signed JWT with user info, passed to SDK |
| **GrowSurf** | `data-grsf-email` attribute | Email passed via HTML data attribute |
| **RefRev** | `userId` in `init()` | User ID passed at SDK initialization |

---

## Attribution Matching: How Events Link Together

### The Core Problem

```
Day 1:  Participant Alice shares link (ref_code: ALICE42)
Day 3:  Anonymous visitor clicks link
Day 5:  Visitor signs up as "bob@example.com"
Day 30: Bob makes first payment

Question: How does RefRev know Bob came from Alice?
```

RefRev supports **two attribution methods**. Choose based on your stack:

| Method | Best For | Requires |
|--------|----------|----------|
| **Method A: referee_id** | Any backend | Client sends events to RefRev API |
| **Method B: Payment Provider** | Stripe/Paddle/Chargebee users | Webhook integration |

---

### Method A: referee_id Matching (Recommended)

Client backend sends events with `referee_id` (your internal user ID) as the primary key.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 1: CLICK (automatic, SDK handles)                         │
│  ───────────────────────────────────────                        │
│  Visitor clicks: https://client.com?ref=ALICE42                 │
│                                                                 │
│  SDK captures and stores in cookie:                             │
│  {                                                              │
│    ref_code: "ALICE42",                                         │
│    click_id: "clk_xyz789",    ← Unique ID for this click        │
│    timestamp: "2025-01-03"                                      │
│  }                                                              │
│                                                                 │
│  SDK also sends click event to RefRev API (for analytics)       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Visitor browses, eventually signs up
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 2: SIGNUP (client backend sends to RefRev)                │
│  ───────────────────────────────────────────────                │
│                                                                 │
│  Frontend code:                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ const attribution = RefRev.getAttribution();            │    │
│  │ // Returns: { ref_code: "ALICE42", click_id: "clk_xyz" }│    │
│  │                                                         │    │
│  │ // Send to your backend with signup data                │    │
│  │ fetch('/api/signup', {                                  │    │
│  │   body: JSON.stringify({                                │    │
│  │     email: 'bob@example.com',                           │    │
│  │     attribution: attribution                            │    │
│  │   })                                                    │    │
│  │ });                                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Backend code:                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ // After creating user in your database                 │    │
│  │ POST https://api.refrev.io/v1/events                    │    │
│  │ Authorization: Bearer sk_live_xxx                       │    │
│  │ {                                                       │    │
│  │   "event_type": "signup",                               │    │
│  │   "referee_id": "user_bob_456",  ← Your internal ID     │    │
│  │   "referee_email": "bob@example.com",                   │    │
│  │   "attribution": {                                      │    │
│  │     "ref_code": "ALICE42",                              │    │
│  │     "click_id": "clk_xyz789"                            │    │
│  │   }                                                     │    │
│  │ }                                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  RefRev creates Referral record:                                │
│  { participant: Alice, referee_id: "user_bob_456" }             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 30 days later, Bob pays
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 3: CONVERSION (client backend sends to RefRev)            │
│  ───────────────────────────────────────────────────            │
│                                                                 │
│  POST https://api.refrev.io/v1/events                           │
│  {                                                              │
│    "event_type": "conversion",                                  │
│    "referee_id": "user_bob_456",  ← Same ID = MATCH!            │
│    "amount": 99.00,                                             │
│    "currency": "EUR"                                            │
│  }                                                              │
│                                                                 │
│  RefRev looks up: "Do we have a referral for user_bob_456?"     │
│  → YES! Found referral linked to Alice                          │
│  → Credit Alice, calculate reward                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Works with any backend/payment system
- `referee_id` survives email changes
- Full control over when events are sent

**Cons:**
- Requires client to send events to RefRev API

---

### Method B: Payment Provider Metadata (Stripe/Paddle/Chargebee)

RefRev reads attribution from payment provider metadata via webhooks. No need to send conversion events.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 1: CLICK (automatic, SDK handles)                         │
│  ───────────────────────────────────────                        │
│  Visitor clicks: https://client.com?ref=ALICE42                 │
│                                                                 │
│  SDK captures and stores in cookie:                             │
│  { ref_code: "ALICE42", click_id: "clk_xyz789" }                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Visitor signs up
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 2: SIGNUP + ATTACH METADATA (client handles)              │
│  ─────────────────────────────────────────────────              │
│                                                                 │
│  Frontend code:                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ const attribution = RefRev.getAttribution();            │    │
│  │ // Send to your backend                                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Backend code (when creating Stripe Customer):                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ const customer = await stripe.customers.create({        │    │
│  │   email: 'bob@example.com',                             │    │
│  │   metadata: {                                           │    │
│  │     refrev_ref_code: 'ALICE42',    ← Store ref_code     │    │
│  │     refrev_click_id: 'clk_xyz789'  ← Store click_id     │    │
│  │   }                                                     │    │
│  │ });                                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Optional: Send signup event to RefRev (for faster tracking)    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Bob pays (Stripe processes payment)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 3: WEBHOOK (automatic, RefRev handles)                    │
│  ───────────────────────────────────────────                    │
│                                                                 │
│  Stripe sends webhook to RefRev:                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Event: invoice.payment_succeeded                        │    │
│  │ Customer: cus_bob123                                    │    │
│  │ Amount: €99.00                                          │    │
│  │ Metadata: {                                             │    │
│  │   refrev_ref_code: "ALICE42",                           │    │
│  │   refrev_click_id: "clk_xyz789"                         │    │
│  │ }                                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  RefRev reads metadata → Knows this was Alice's referral        │
│  → Credit Alice, calculate reward                               │
│                                                                 │
│  All future payments from this Customer automatically           │
│  attributed to Alice (metadata persists)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Supported Payment Providers:**

| Provider | Webhook Events | Metadata Field |
|----------|----------------|----------------|
| **Stripe** | `invoice.payment_succeeded`, `checkout.session.completed` | `customer.metadata` |
| **Paddle** | `subscription.created`, `transaction.completed` | `custom_data` |
| **Chargebee** | `payment_succeeded`, `subscription_created` | `meta_data` |

**Pros:**
- 100% server-side attribution (immune to ad blockers)
- No need to send conversion events
- Future payments auto-attributed

**Cons:**
- Requires Stripe/Paddle/Chargebee
- Must attach metadata at customer creation

---

### Choosing a Method

| Scenario | Recommended Method |
|----------|-------------------|
| Using Stripe/Paddle/Chargebee | **Method B** (simpler, more reliable) |
| Using other payment provider | **Method A** (referee_id) |
| Want both signup AND conversion tracking | **Both** (Method A for signup, Method B for conversion) |
| No payment provider (lead gen only) | **Method A** (referee_id) |

### Matching Keys Summary

| Key | Source | Reliability |
|-----|--------|-------------|
| `referee_id` | Your internal user ID | ✅ Best — deterministic |
| Payment provider customer ID | Stripe/Paddle/Chargebee | ✅ Best — immutable |
| `referee_email` | User's email | ⚠️ Good — can change |
| `click_id` | Generated on click | ⚠️ Fallback — links click to signup |

---

## Consent Handling in SDK

### Why Consent Matters

GDPR and ePrivacy require user consent before setting non-essential cookies. RefRev SDK respects this by supporting three consent modes.

### Consent Modes

| Mode | Cookies Set? | Events Sent? | Widget Works? | Use Case |
|------|--------------|--------------|---------------|----------|
| `granted` | ✅ Yes | ✅ Yes | ✅ Full | User accepted cookies |
| `denied` | ❌ No | ❌ No | ⚠️ Limited | User declined cookies |
| `pending` | ❌ No | ⏸️ Queued | ✅ Yes | Waiting for user choice |

### Setting Consent

```javascript
// Option 1: Set at initialization (if you already know consent status)
RefRev.init({ 
  apiKey: 'pk_live_xxx',
  consent: 'granted'  // User already accepted in previous session
});

// Option 2: Start with pending, update later
RefRev.init({ 
  apiKey: 'pk_live_xxx',
  consent: 'pending'  // Default: wait for user choice
});

// When user clicks "Accept Cookies"
document.getElementById('accept-btn').addEventListener('click', function() {
  RefRev.setConsent('granted');
});

// When user clicks "Decline Cookies"
document.getElementById('decline-btn').addEventListener('click', function() {
  RefRev.setConsent('denied');
});
```

### Integration with Consent Management Platforms (CMP)

**OneTrust:**
```javascript
// OneTrust calls this when consent changes
function OptanonWrapper() {
  if (OnetrustActiveGroups.includes('C0003')) { // Functional cookies
    RefRev.setConsent('granted');
  } else {
    RefRev.setConsent('denied');
  }
}
```

**Cookiebot:**
```javascript
window.addEventListener('CookiebotOnAccept', function() {
  if (Cookiebot.consent.preferences) { // Functional/preferences cookies
    RefRev.setConsent('granted');
  }
});

window.addEventListener('CookiebotOnDecline', function() {
  RefRev.setConsent('denied');
});
```

**Osano:**
```javascript
Osano.cm.addEventListener('osano-cm-consent-changed', function(change) {
  if (change.ANALYTICS === 'ACCEPT') {
    RefRev.setConsent('granted');
  } else {
    RefRev.setConsent('denied');
  }
});
```

### Detailed Behavior per Mode

**GRANTED:**
```
┌─────────────────────────────────────────────────────────────────┐
│  User has accepted cookies                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ Cookies set:                                                │
│     • _rr_ref    (attribution data: ref_code, click_id, UTMs)   │
│     • _rr_vid    (visitor ID - anonymous tracking)              │
│     • _rr_uid    (user ID - after identify())                   │
│     • _rr_sess   (session ID)                                   │
│                                                                 │
│  ✅ localStorage backup:                                        │
│     • Same data stored as fallback if cookies cleared           │
│                                                                 │
│  ✅ Events sent to RefRev:                                      │
│     • link.clicked (when referral link clicked)                 │
│     • widget.viewed (when widget displayed)                     │
│     • link.shared (when user shares)                            │
│                                                                 │
│  ✅ Widget fully functional:                                    │
│     • Shows personalized referral link                          │
│     • Displays stats (referrals, conversions, earnings)         │
│     • Share buttons work with tracking                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**DENIED:**
```
┌─────────────────────────────────────────────────────────────────┐
│  User has declined cookies                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ❌ No cookies set                                              │
│  ❌ No localStorage used                                        │
│  ❌ No events sent to RefRev                                    │
│                                                                 │
│  ⚠️ Widget shows but limited:                                   │
│     • Generic referral link (if user identified)                │
│     • No stats displayed                                        │
│     • Share buttons work but no tracking                        │
│                                                                 │
│  ⚠️ Attribution still possible via:                             │
│     • URL parameter (?ref=XXX) passed to backend                │
│     • Server-side attribution (Method B) still works            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**PENDING:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Waiting for user's consent choice                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ❌ No cookies set (yet)                                        │
│  ❌ No localStorage used (yet)                                  │
│                                                                 │
│  ⏸️ Events queued in memory:                                    │
│     • Click events captured but not sent                        │
│     • Queue holds up to 50 events                               │
│     • Queue expires after 30 minutes                            │
│                                                                 │
│  ✅ Widget shows optimistically:                                │
│     • Assumes consent will be granted                           │
│     • Full UI displayed                                         │
│                                                                 │
│  On setConsent('granted'):                                      │
│     → Cookies set                                               │
│     → Queued events flushed to RefRev                           │
│     → Normal operation continues                                │
│                                                                 │
│  On setConsent('denied'):                                       │
│     → Queue cleared                                             │
│     → Switches to denied mode                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Cookie Specifications

| Cookie | Purpose | Expiry | Size | GDPR Category |
|--------|---------|--------|------|---------------|
| `_rr_sess` | Session tracking | Session | ~40 bytes | Strictly Necessary |
| `_rr_ref` | Attribution (ref_code, click_id, UTMs) | 90 days | ~200 bytes | Functional |
| `_rr_vid` | Anonymous visitor ID | 1 year | ~40 bytes | Functional |
| `_rr_uid` | User ID (after identify) | 1 year | ~40 bytes | Functional |

### What to Include in Privacy Policy

```
RefRev Referral Tracking

We use RefRev to manage our referral program. When you accept 
functional cookies, RefRev may set the following cookies:

- _rr_ref: Stores referral attribution data (90 days)
- _rr_vid: Anonymous visitor identifier (1 year)
- _rr_uid: Your user identifier after login (1 year)
- _rr_sess: Session identifier (expires when browser closes)

These cookies help us track referrals and reward our advocates. 
You can decline these cookies, but referral tracking may not 
work correctly.

Data processor: RefRev GmbH, [address]
```

## First-Party Cookie Strategy

Cookies set on **customer's domain** (GDPR-compliant first-party):

| Cookie | Purpose | Expiry | Size |
|--------|---------|--------|------|
| `_rr_ref` | Attribution data (ref_code, click_id, UTMs) | 90 days | ~200 bytes |
| `_rr_vid` | Visitor ID (anonymous) | 1 year | ~40 bytes |
| `_rr_uid` | User ID (after identify) | 1 year | ~40 bytes |
| `_rr_sess` | Session ID | Session | ~40 bytes |
| `_rr_consent` | Consent level | 1 year | ~20 bytes |

## Attribution Flow

```
1. Visitor clicks referral link (?ref=ABC123&utm_source=linkedin)
           │
           ▼
2. SDK captures ref_code, UTMs, referrer, device info
           │
           ▼
3. SDK stores in first-party cookie + localStorage backup
           │
           ▼
4. SDK sends link.clicked event to platform
           │
           ▼
5. SDK cleans URL (removes ?ref= to prevent bookmark pollution)
           │
           ▼
6. Visitor browses site, eventually reaches signup
           │
           ▼
7. Frontend calls RefRev.getAttribution()
   Returns: { ref_code: "ABC123", click_id: "clk_xyz", ... }
           │
           ▼
8. Frontend passes attribution to backend with signup request
           │
           ▼
9. Backend sends signup event to platform (with attribution)
           │
           ▼
10. Platform creates Referral, evaluates Pulse, triggers reward
```

## Server-Side Event Tracking

For high-trust events (signup, payment) — always from backend:

```javascript
// Client backend sends to platform
POST https://api.refrev.io/v1/events
Authorization: Bearer sk_live_xxx

{
  "event_type": "signup",
  "event_id": "signup_user_456",  // Idempotency key
  "user": {
    "id": "user_456",
    "email": "user@example.com"
  },
  "attribution": {
    "ref_code": "ABC123",         // From SDK getAttribution()
    "click_id": "clk_xyz789"
  }
}
```

---


# 10. Attribution

## Touch Model

A **Touch** is any tracked interaction in the referral journey:

| Touch Type | Description | Data Captured |
|------------|-------------|---------------|
| **Click** | Referral link clicked | ref_code, timestamp, source, UTMs, device |
| **Share** | Link shared via channel | channel, timestamp, share method |
| **View** | Widget or page viewed | page, timestamp, duration |
| **Email Open** | Invitation email opened | timestamp, email client |
| **Email Click** | Link in email clicked | timestamp, link destination |

## Attribution Models

| Model | Credit Assignment | Use Case | Version |
|-------|-------------------|----------|---------|
| **First-Touch** | 100% to first participant | Simple, clear | MVP |
| **Last-Touch** | 100% to last participant | Sales-heavy cycles | MVP |
| **Linear** | Equal split among all | Complex journeys | V2 |
| **Time-Decay** | More to recent touches | Long sales cycles | V2 |
| **Position-Based** | 40% first, 40% last, 20% middle | Balanced | V2 |
| **AI-Weighted** | ML-based optimal assignment | Maximum accuracy | V2 |

## First-Touch Example (MVP Default)

```
Day 1:  Participant A shares link
Day 3:  Visitor clicks A's link     ← First touch (captured)
Day 5:  Participant B shares link
Day 7:  Visitor clicks B's link
Day 10: Visitor signs up

Attribution: 100% to Participant A (first touch wins)
```

## Last-Touch Example

```
Day 1:  Participant A shares link
Day 3:  Visitor clicks A's link
Day 5:  Participant B shares link
Day 7:  Visitor clicks B's link     ← Last touch before conversion
Day 10: Visitor signs up

Attribution: 100% to Participant B (last touch wins)
```

## Attribution Windows

| Window | Default Duration | Purpose |
|--------|------------------|---------|
| **Click-to-Signup** | 30 days | Lead attribution |
| **Click-to-Conversion** | 90 days | Revenue attribution |
| **Signup-to-Conversion** | 60 days | Activation tracking |

Windows are configurable per campaign.

## Attribution Resolution Priority

When conversion occurs, platform resolves attribution in this order:

```
1. Check signup event for ref_code
   └── If found → Direct attribution

2. Check for click_id correlation
   └── If found → Match to original click

3. Check cookie/localStorage (via SDK)
   └── If found → Use stored attribution

4. Check email match (platform-sent invitations)
   └── If found → Match to invitation

5. No attribution found
   └── Record as organic
```

## Multi-Touch Attribution (V2)

When multiple participants touch the same referee:

```yaml
attribution:
  model: linear
  touches:
    - participant_id: prt_A
      touch_type: click
      timestamp: "2024-01-01T10:00:00Z"
      channel: linkedin
      weight: 0.33
      
    - participant_id: prt_B
      touch_type: click
      timestamp: "2024-01-05T14:00:00Z"
      channel: email
      weight: 0.33
      
    - participant_id: prt_C
      touch_type: click
      timestamp: "2024-01-08T09:00:00Z"
      channel: twitter
      weight: 0.34
      
  total_reward: €100
  distribution:
    - participant_id: prt_A
      amount: €33
    - participant_id: prt_B
      amount: €33
    - participant_id: prt_C
      amount: €34
```

---


# 11. AI Features

## AI Capability Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AI CAPABILITIES                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CAMPAIGN SETUP                  CONTENT & WIDGET GENERATION        │
│  ───────────────                 ──────────────────────────         │
│  • Website analysis              • Email templates                  │
│  • Campaign config generation    • Widget design & code             │
│  • Reward recommendations        • Landing page copy                │
│  • Playbook suggestions          • Social share messages            │
│                                                                     │
│  OPTIMIZATION                    ANALYTICS & INSIGHTS               │
│  ────────────                    ───────────────────                │
│  • Incentive optimization        • Performance insights             │
│  • Segmentation recommendations  • Anomaly detection                │
│  • Send time optimization        • Program health scoring           │
│                                                                     │
│  FRAUD & RISK                    PREDICTION (V2)                    │
│  ─────────────                   ──────────────                     │
│  • Pattern detection             • Propensity scoring               │
│  • Risk scoring                  • Churn prediction                 │
│  • Auto-blocking                 • Revenue forecasting              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## AI Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Embedded** | AI in core flows, not a separate chatbot |
| **Human-in-the-loop** | Risky/irreversible actions require approval |
| **Explainable** | AI outputs include reasoning |
| **Overridable** | Humans can always reverse decisions |
| **Privacy-safe** | No PII required for most features |

## AI Data Access Requirements

**Critical: AI needs NO login access to client systems.**

| AI Feature | Data Source | Needs Client Credentials? |
|------------|-------------|---------------------------|
| Campaign setup | Public website scraping | ❌ No |
| Widget generation | Brand inputs + templates | ❌ No |
| Landing page copy | Public website + templates | ❌ No |
| Email templates | Templates + product context | ❌ No |
| Fraud detection | Platform's own event data | ❌ No |
| Incentive optimization | Platform's own analytics | ❌ No |
| Propensity scoring | Platform's behavioral data | ❌ No |

---

## Widget Generation by AI

### Required Inputs

| Input | Source | Purpose |
|-------|--------|---------|
| **Brand colors** | Client provides OR auto-extracted from website | Match visual identity |
| **Logo URL** | Client provides | Brand display |
| **Font family** | Client provides OR detected from website | Typography consistency |
| **Product name** | Client provides | Personalized copy |
| **Reward details** | From campaign/variant config | Accurate incentive display |

### Optional Inputs (Better Results)

| Input | Purpose |
|-------|---------|
| **CSS variables/design tokens** | Exact styling match |
| **Component library name** | Match existing UI (shadcn, MUI, Tailwind) |
| **Screenshot of dashboard** | Visual context for placement |
| **Tone of voice** | Messaging style (professional, casual, playful) |
| **Target placement** | Where widget will appear in app |

### AI Outputs

```
AI generates (client reviews & approves):
├── Widget HTML/CSS (embed anywhere)
├── React component (for React apps)
├── Vue component (for Vue apps)
├── Web Component (framework-agnostic)
├── Copy variants (variant-ready)
└── Responsive variants (mobile, tablet, desktop)
```

### Widget Generation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Client provides:          AI generates:                        │
│  ─────────────────         ─────────────                        │
│  • Website URL             • 3 widget variants                  │
│  • Brand colors            • Copy options                       │
│  • Logo                    • Component code                     │
│  • Tone preference         • Preview renders                    │
│                                                                 │
│         │                           │                           │
│         ▼                           ▼                           │
│  ┌─────────────┐           ┌─────────────┐                     │
│  │   Inputs    │──────────►│  AI Engine  │                     │
│  └─────────────┘           └──────┬──────┘                     │
│                                   │                             │
│                                   ▼                             │
│                          ┌─────────────┐                        │
│                          │   Preview   │                        │
│                          └──────┬──────┘                        │
│                                 │                               │
│                    ┌────────────┼────────────┐                  │
│                    ▼            ▼            ▼                  │
│              [Variant A]  [Variant B]  [Variant C]              │
│                    │            │            │                  │
│                    └────────────┼────────────┘                  │
│                                 │                               │
│                                 ▼                               │
│                    ┌─────────────────────┐                      │
│                    │  Human Selection    │ ◄── Required         │
│                    │  & Approval         │                      │
│                    └─────────────────────┘                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**AI never auto-deploys widgets. Human approval always required.**

---

## Campaign Setup Assistant

### Flow

```
[Client provides website URL]
         │
         ▼
┌──────────────────┐
│  Website Scraper │ ── Extracts: pricing, features, value props
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  LLM Analysis    │ ── Determines: vertical, ideal pulse, reward range
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Template Engine  │ ── Generates: 3 campaign configs
└────────┬─────────┘
         │
         ▼
   ┌─────┴─────┐─────────────┐
   ▼           ▼             ▼
[Conservative] [Balanced] [Aggressive]
   │           │             │
   └───────────┼─────────────┘
               │
               ▼
     [Human Selection Required]
```

### What AI Analyzes (Public Data Only)

- Pricing page → Suggests reward amounts
- Features → Identifies value props for messaging
- Industry signals → Selects appropriate Playbook
- Testimonials → Extracts social proof
- Company size signals → Suggests segment strategy

---

## Incentive Optimization

### What It Is

AI analyzes conversion data and recommends reward adjustments to maximize ROI.

### Example

```
AI observes:
• Segment "SMB": €25 reward → 5% conversion rate
• Segment "Enterprise": €25 reward → 12% conversion rate

AI recommends:
• Segment "SMB": Increase to €40 (price-sensitive, needs higher incentive)
• Segment "Enterprise": Decrease to €20 (already converting well)

Projected impact: +15% overall conversions, +8% ROI
```

### All Optimization Bounds (with Simple Examples)

| Bound | What It Means | Example | Effect |
|-------|---------------|---------|--------|
| `min_reward_amount` | AI cannot recommend below this | **€10** | AI won't suggest €5 reward even if data says it would work |
| `max_reward_amount` | AI cannot recommend above this | **€200** | AI won't suggest €300 even for high-value segments |
| `max_increase_percent` | Single change can't increase more than X% | **25%** | If current reward is €40, AI can suggest max €50 (not €60) |
| `max_decrease_percent` | Single change can't decrease more than X% | **15%** | If current reward is €100, AI can suggest min €85 (not €70) |
| `max_daily_budget_impact` | Changes can't cost more than X/day extra | **€500** | If change would add €600/day in rewards, blocked |
| `max_monthly_budget_impact` | Changes can't cost more than X/month extra | **€5,000** | Prevents runaway spending |
| `max_total_budget` | Hard cap for entire campaign | **€50,000** | AI stops recommending when budget exhausted |
| `min_sample_size` | Need X conversions before AI recommends | **100** | No recommendations until statistically meaningful |
| `confidence_threshold` | Statistical confidence required | **0.95** | AI only recommends if 95% confident it will help |
| `min_test_duration_days` | Wait X days before concluding test | **7** | Prevents premature decisions |
| `cooldown_days` | Wait X days between changes to same variant | **7** | Prevents constant tweaking |
| `max_changes_per_week` | Max X changes across all variants | **2** | Limits optimization frequency |
| `excluded_segments` | AI cannot touch these segments | **["vip"]** | VIP segment rewards managed manually only |
| `excluded_reward_types` | AI cannot change these reward types | **["cash"]** | Cash rewards fixed, AI can only adjust credits |
| `require_approval_above` | Changes above €X need human approval | **€50** | €60 change → needs approval; €30 change → auto |
| `auto_approve_below` | Changes below €X auto-apply | **€20** | Small optimizations happen automatically |

### Scenario Examples

**Scenario 1: AI wants to increase SMB reward from €25 to €40**
```
Check: max_increase_percent = 25%
€25 × 1.25 = €31.25 max allowed
€40 > €31.25 → BLOCKED

AI adjusts recommendation to €31
```

**Scenario 2: AI wants to decrease Enterprise reward from €100 to €70**
```
Check: max_decrease_percent = 15%
€100 × 0.85 = €85 min allowed
€70 < €85 → BLOCKED

AI adjusts recommendation to €85
```

**Scenario 3: AI recommends €45 change (from €30 to €75)**
```
Check: require_approval_above = €50
Change amount = €75 - €30 = €45
€45 < €50 → AUTO-APPROVED

Change applies without human review
```

**Scenario 4: AI recommends €60 change (from €40 to €100)**
```
Check: require_approval_above = €50
Change amount = €100 - €40 = €60
€60 > €50 → REQUIRES APPROVAL

Notification sent to Campaign Manager
```

### Example Configuration

```yaml
incentive_optimization:
  enabled: true
  bounds:
    # Reward limits
    min_reward_amount: 10          # Never below €10
    max_reward_amount: 200         # Never above €200
    
    # Change limits
    max_increase_percent: 25       # Max 25% increase per change
    max_decrease_percent: 15       # Max 15% decrease per change
    
    # Budget limits
    max_daily_budget_impact: 500   # Max €500/day extra
    max_monthly_budget_impact: 5000 # Max €5,000/month extra
    
    # Statistical requirements
    min_sample_size: 100           # Need 100 conversions first
    confidence_threshold: 0.95     # 95% confidence required
    
    # Timing
    min_test_duration_days: 7      # Wait 7 days minimum
    cooldown_days: 7               # 7 days between changes
    max_changes_per_week: 2        # Max 2 changes/week
    
    # Approval thresholds
    auto_approve_below: 20         # Auto-apply if < €20 change
    require_approval_above: 50     # Need approval if > €50 change
    
    # Exclusions
    excluded_segments: 
      - "vip"
      - "enterprise_custom"
    excluded_reward_types: []
```

---

## Propensity Scoring

### What It Is

ML model that predicts how likely a participant is to generate successful referrals.

### Score Components

| Score | Range | Predicts |
|-------|-------|----------|
| **Referral Likelihood** | 0-100 | Will they share their link? |
| **Conversion Likelihood** | 0-100 | Will their referrals convert? |
| **Value Likelihood** | 0-100 | Will conversions be high-value? |
| **Combined Score** | 0-100 | Weighted average |

### Input Features

| Feature Category | Examples |
|------------------|----------|
| **Historical behavior** | Past referral count, conversion rate, earnings |
| **Engagement** | Days since last activity, share frequency |
| **Product usage** | Feature adoption, session frequency (from client) |
| **Account attributes** | Tenure, plan type, company size |
| **Network signals** | Social connections (if available) |

### Output

```yaml
participant:
  id: prt_123
  propensity:
    referral_likelihood: 82      # High chance they'll share
    conversion_likelihood: 65    # Medium chance conversions happen
    value_likelihood: 71         # Good chance of high-value conversions
    combined_score: 73           # Overall propensity
    
    # Factors (explainable)
    top_factors:
      - "High product engagement (daily active)"
      - "Previous referrals had 80% conversion rate"
      - "Enterprise plan with large network"
    
    # Recommendations
    recommended_actions:
      - "Include in VIP outreach campaign"
      - "Offer milestone bonus to encourage more referrals"
```

### Use Cases

| Use Case | How Propensity Helps |
|----------|---------------------|
| **Campaign targeting** | Focus on high-propensity participants |
| **Incentive allocation** | Higher rewards for high-propensity segments |
| **Proactive outreach** | Nudge dormant high-propensity users |
| **Resource allocation** | Priority support for valuable participants |
| **Churn prevention** | Identify at-risk advocates early |

---

## AI Guardrails Summary

| Feature | Auto-Execute? | Human Approval? | Reversible? |
|---------|---------------|-----------------|-------------|
| Campaign setup | ❌ Never | ✅ Always | N/A |
| Widget generation | ❌ Never | ✅ Always | N/A |
| Content generation | ❌ Never | ✅ Always | N/A |
| Segmentation recs | ❌ Never | ✅ Always | N/A |
| Incentive optimization | ⚠️ Within bounds | ⚠️ Above threshold | ✅ Yes |
| Fraud detection | ⚠️ High-risk auto-block | ✅ Medium-risk review | ✅ Yes |
| Propensity scoring | ✅ Scoring only | ❌ N/A | N/A |
| Health score | ✅ Calculation only | ❌ N/A | N/A |

---

# Appendix: Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Dec 2024 | Initial specification |
| 2.0 | Feb 2025 | Consolidated file, Campaign→Variant→Segment model |
| 3.0 | Feb 2025 | Reward config at Variant level, Trust Model clarification |
| 3.1 | Feb 2025 | SDK: vanilla JS only; `identify()` explanation; Two attribution methods (referee_id + Payment Provider metadata with equal detail); Expanded consent handling (CMP integration examples, detailed behavior per mode, privacy policy template) |
| 3.2 | Feb 2026 | Participant enrollment methods (how clients register referrers); Widget visibility based on enrollment status; SDK userId in init() replaces separate identify(); Enrollment model (open/selective) as campaign-level setting; Default variant concept (every campaign has at least one); Variant resolution at enrollment time (not referee click); Variant allocation fallback chain; Removed A/B testing language — segmentation with random assignment only |

---

**Maintainer:** Product Team  
**Next Review:** Pre-launch (December 2026)
