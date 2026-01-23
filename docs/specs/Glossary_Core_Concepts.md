# 📖 Glossary & Core Concepts
## Standard Terms for Code, Documentation & Communication

**Version:** 1.0  
**Created:** December 2024  
**Purpose:** Single source of truth for terminology

---

# 1. Actor Glossary

## Primary Actors

| Term | Code Name | Definition | Also Called |
|------|-----------|------------|-------------|
| **Participant** | `participant` | User enrolled in referral program who can invite others | Referrer, Advocate |
| **Invitee** | `invitee` | Person who clicked referral link, not yet converted | Lead, Prospect |
| **Converted** | `converted` | Invitee who completed the conversion action | Customer, Referred User |
| **Beneficiary** | `beneficiary` | Converted user who receives reward in two-sided program | Rewarded Invitee |

## When Does Invitee Become Participant?

| Scenario | Invitee → Participant? | Condition |
|----------|------------------------|-----------|
| Invitee clicks link | ❌ No | Just a click |
| Invitee signs up | ⚠️ Depends | If `participant_eligibility = all_users` |
| Invitee starts trial | ⚠️ Depends | If `participant_eligibility = trial_users` |
| Invitee pays (converts) | ✅ Usually | If `participant_eligibility = paying_customers` |

### Participant Eligibility Configuration

| Setting | Code Name | Who Can Be Participant |
|---------|-----------|------------------------|
| All Users | `all_users` | Anyone with account (incl. free) |
| Trial Users | `trial_users` | Users on trial or higher |
| Paying Customers | `paying_customers` | Only paid users |
| Specific Plan | `plan:silver` | Only users on Silver+ plan |

### Can Non-Paying User Invite Others?

**Yes, if configured.** Example scenarios:

| Config | Free User Signs Up | Can See Widget? | Can Invite? |
|--------|-------------------|-----------------|-------------|
| `paying_customers` | Yes | ❌ No | ❌ No |
| `all_users` | Yes | ✅ Yes | ✅ Yes |
| `trial_users` | Yes (on trial) | ✅ Yes | ✅ Yes |

**Why allow free users to invite?**
- Viral growth (more reach)
- Convert them later
- Network effects

**Why restrict to paying?**
- Higher quality referrals
- Prevent abuse
- Reward loyal customers

## Actor Status

| Term | Code Name | Definition |
|------|-----------|------------|
| **Pending** | `pending` | Enrolled but no activity yet |
| **Active** | `active` | Has shared at least once |
| **Successful** | `successful` | Has at least one conversion |
| **Dormant** | `dormant` | No activity for 30+ days |
| **Churned** | `churned` | Left program or product |

## Invitee Status

| Term | Code Name | Definition |
|------|-----------|------------|
| **Clicked** | `clicked` | Clicked referral link, cookie set |
| **Signed Up** | `signed_up` | Created account |
| **Trial** | `trial` | Started free trial |
| **Converted** | `converted` | Completed conversion action |
| **Expired** | `expired` | Attribution window passed |
| **Lost** | `lost` | Left without converting |

---

# 2. Campaign Glossary

## Campaign Types

| Term | Code Name | Definition | MVP |
|------|-----------|------------|-----|
| **User Referral** | `user_referral` | Customers refer friends | ✅ |
| **Waitlist** | `waitlist` | Pre-launch viral campaign | V1.1 |
| **Affiliate** | `affiliate` | External partners for commission | V1.2 |
| **Employee** | `employee` | Internal staff referrals | V1.2 |
| **Contest** | `contest` | Time-limited competition | V1.2 |
| **Partner** | `partner` | B2B reseller/agency | V2 |
| **Influencer** | `influencer` | Content creators | V2 |
| **Ambassador** | `ambassador` | Long-term advocates | V2 |

## Campaign Status

| Term | Code Name | Definition |
|------|-----------|------------|
| **Draft** | `draft` | Not yet published |
| **Scheduled** | `scheduled` | Set to start in future |
| **Active** | `active` | Currently running |
| **Paused** | `paused` | Temporarily stopped |
| **Ended** | `ended` | Completed or stopped |

---

## User Journey by Campaign Type

### User Referral Journey

```
Customer ──► Sees widget ──► Gets link ──► Shares ──► Invitee clicks ──► Invitee converts ──► Reward
```

| Step | Actor | Action | System Response |
|------|-------|--------|-----------------|
| 1 | Customer | Logs into app | Shows widget |
| 2 | Customer | Clicks "Get my link" | Becomes Participant |
| 3 | Participant | Shares link | Tracks share |
| 4 | Invitee | Clicks link | Sets cookie, records click |
| 5 | Invitee | Signs up | Records signup |
| 6 | Invitee | Pays | Becomes Converted |
| 7 | System | - | Credits reward to Participant |

---

### Waitlist Journey

```
Visitor ──► Joins waitlist ──► Gets position #500 ──► Shares ──► Friend joins ──► Moves to #400
```

| Step | Actor | Action | System Response |
|------|-------|--------|-----------------|
| 1 | Visitor | Submits email | Assigns position #500 |
| 2 | Visitor | Gets link | Becomes Participant |
| 3 | Participant | Shares link | Tracks share |
| 4 | Invitee | Clicks link | Records click |
| 5 | Invitee | Joins waitlist | Invitee gets position #501 |
| 6 | System | - | Moves Participant to #400 (+100 boost) |
| 7 | Launch | - | Access by position order |

---

### Affiliate Journey

```
Applicant ──► Applies ──► Approved ──► Gets portal ──► Promotes ──► Conversions ──► Commission
```

| Step | Actor | Action | System Response |
|------|-------|--------|-----------------|
| 1 | Applicant | Fills application | Status: Pending |
| 2 | Client Admin | Reviews | Approves/Rejects |
| 3 | Affiliate | Receives email | Account created |
| 4 | Affiliate | Logs into portal | Sees dashboard, links |
| 5 | Affiliate | Promotes (blog, social) | Tracks clicks |
| 6 | Invitee | Clicks + converts | Records conversion |
| 7 | System | - | Calculates commission |
| 8 | Affiliate | Requests payout | Processes payment |

---

### Employee Referral Journey

```
Employee ──► SSO login ──► Sees open jobs ──► Submits candidate ──► Candidate hired ──► Bonus
```

| Step | Actor | Action | System Response |
|------|-------|--------|-----------------|
| 1 | Employee | Logs in via company SSO | Sees internal portal |
| 2 | Employee | Views open positions | Shows eligible jobs |
| 3 | Employee | Submits candidate info | Records referral |
| 4 | HR | Reviews candidate | Updates status |
| 5 | Candidate | Interviews | Status: Interviewing |
| 6 | Candidate | Gets hired | Status: Hired |
| 7 | System | - | Credits bonus to Employee |

---

### Contest Journey

```
Participant ──► Joins contest ──► Refers many ──► Leaderboard updates ──► Contest ends ──► Winners announced
```

| Step | Actor | Action | System Response |
|------|-------|--------|-----------------|
| 1 | User | Joins contest | Becomes Participant |
| 2 | Participant | Shares heavily | Tracks all referrals |
| 3 | Invitees | Convert | Counts conversions |
| 4 | System | - | Updates leaderboard |
| 5 | Contest | Ends | Freezes leaderboard |
| 6 | System | - | Awards prizes to top N |

---

### Partner Journey

```
Agency ──► Invited ──► Contract signed ──► Registers deals ──► Deals close ──► Revenue share
```

| Step | Actor | Action | System Response |
|------|-------|--------|-----------------|
| 1 | Client | Identifies agency | Initiates contact |
| 2 | Client | Sends invitation | Creates pending account |
| 3 | Partner | Signs contract | Account activated |
| 4 | Partner | Registers deal | Deal in pipeline |
| 5 | Deal | Closes (customer pays) | Records revenue |
| 6 | System | - | Calculates revenue share |
| 7 | Partner | Invoices | Receives payment |

---

# 3. Reward Glossary

## Reward Sides

| Term | Code Name | Definition |
|------|-----------|------------|
| **One-Sided** | `one_sided` | Only participant gets reward |
| **Two-Sided** | `two_sided` | Both participant AND beneficiary get rewards |

### Two-Sided Reward Flow

```
Participant (JOHN) ──shares──► Invitee (MARY) ──converts──► Beneficiary (MARY)
      │                                                            │
      ▼                                                            ▼
  Gets €20 cash                                              Gets €10 discount
```

### Two-Sided Examples

| Campaign Message | Participant Gets | Beneficiary Gets |
|------------------|------------------|------------------|
| "Refer a friend, you both get €20" | €20 | €20 |
| "Give €10, Get €20" | €20 | €10 discount |
| "Give 20% off, Get €15" | €15 | 20% discount |
| "Give 1 month free, Get €30" | €30 | 1 month free |

### Two-Sided Configuration

| Field | Description | Example |
|-------|-------------|---------|
| `participant_reward_type` | What participant gets | `cash_fixed` |
| `participant_reward_value` | Amount | `20` |
| `beneficiary_reward_type` | What beneficiary gets | `discount_percent` |
| `beneficiary_reward_value` | Amount | `20` |
| `beneficiary_reward_applies_to` | When applied | `first_purchase` |

---

# 4. Viral Growth Concepts

## Viral Loop

| Term | Code Name | Definition |
|------|-----------|------------|
| **Viral Loop** | `viral_loop` | Cycle where users invite users who invite more users |
| **Viral Coefficient (K)** | `k_factor` | Avg invites × conversion rate. K>1 = exponential growth |
| **Cycle Time** | `cycle_time` | Time for one viral loop iteration |

### Viral Coefficient Formula

```
K = (Avg invites per participant) × (Invite conversion rate)

Example:
- Each participant invites 5 people
- 20% of invitees convert
- K = 5 × 0.20 = 1.0

K > 1 = Viral growth (exponential)
K = 1 = Stable (each user replaces themselves)
K < 1 = Declining (need paid acquisition)
```

## Feedback Loop Types

| Term | Code Name | Definition |
|------|-----------|------------|
| **Positive Feedback** | `positive_feedback` | Success breeds more success |
| **Network Effect** | `network_effect` | Product more valuable with more users |
| **Social Proof** | `social_proof` | Others' actions influence behavior |

### Growth Amplifiers

| Amplifier | Code Name | How It Works |
|-----------|-----------|--------------|
| **Leaderboard** | `leaderboard` | Competition drives more invites |
| **Milestones** | `milestones` | Goals motivate continued effort |
| **Urgency** | `urgency` | Limited time increases action |
| **Scarcity** | `scarcity` | Limited spots increase desire |
| **Social Proof** | `social_proof` | "1,234 people joined" |

## Viral Metrics

| Metric | Code Name | Formula |
|--------|-----------|---------|
| **K-Factor** | `k_factor` | invites × conversion_rate |
| **Viral Cycle Time** | `cycle_time_days` | Avg days from invite to conversion |
| **Invitation Rate** | `invitation_rate` | participants_who_invited / total_participants |
| **Invites Per Participant** | `invites_per_participant` | total_invites / active_participants |
| **Invite Conversion Rate** | `invite_conversion_rate` | conversions / clicks |

## Reward Types

| Term | Code Name | Definition | MVP |
|------|-----------|------------|-----|
| **Cash Fixed** | `cash_fixed` | Fixed amount (€20) | ✅ |
| **Cash Percent** | `cash_percent` | % of purchase (20%) | ✅ |
| **Cash Recurring** | `cash_recurring` | % of subscription ongoing | ✅ |
| **Account Credit** | `credit` | Credit on client's platform | ✅ |
| **Discount Percent** | `discount_percent` | % off purchase | ✅ |
| **Discount Fixed** | `discount_fixed` | Fixed amount off | ✅ |
| **Feature Unlock** | `feature_unlock` | Unlock premium feature | V1.1 |
| **Plan Upgrade** | `plan_upgrade` | Free upgrade to higher tier | V1.1 |
| **Extended Trial** | `extended_trial` | Extra trial days | V1.1 |
| **Gift Card** | `gift_card` | Third-party gift card | V1.2 |
| **Position Boost** | `position_boost` | Move up waitlist | V1.1 |
| **Points** | `points` | Loyalty points | V1.2 |

## Reward Status

| Term | Code Name | Definition |
|------|-----------|------------|
| **Pending** | `pending` | Earned, awaiting approval period |
| **Approved** | `approved` | Ready to be paid |
| **Held** | `held` | Flagged for review |
| **Paid** | `paid` | Successfully paid out |
| **Revoked** | `revoked` | Cancelled (refund, fraud) |
| **Expired** | `expired` | Not claimed in time |

---

# 5. Reward Mechanisms

## Overview

| Mechanism | Code Name | Purpose |
|-----------|-----------|---------|
| **Two-Sided** | `two_sided` | Incentivize both parties |
| **Tiered** | `tiered` | Reward top performers more |
| **Milestone** | `milestone` | Celebrate achievements |
| **Leaderboard** | `leaderboard` | Drive competition |
| **Recurring** | `recurring` | Long-term engagement |

---

## 5.1 Two-Sided Reward

```
┌─────────────┐    shares    ┌─────────────┐   converts   ┌─────────────┐
│ Participant │─────────────►│   Invitee   │─────────────►│ Beneficiary │
└──────┬──────┘              └─────────────┘              └──────┬──────┘
       │                                                         │
       ▼                                                         ▼
   Reward A                                                  Reward B
   (€20 cash)                                            (€10 discount)
```

---

## 5.2 Tiered Rewards

```
Performance:  ─────────────────────────────────────────────►
              │         │              │              │
Tier:      Bronze    Silver         Gold         Platinum
Rate:        10%       15%           20%            25%
Threshold:    0        10            25            100 conversions
```

| Tier | Code | Min Conversions | Commission | Perks |
|------|------|-----------------|------------|-------|
| Bronze | `bronze` | 0 | 10% | Basic |
| Silver | `silver` | 10 | 15% | + Newsletter |
| Gold | `gold` | 25 | 20% | + Early access |
| Platinum | `platinum` | 100 | 25% | + Dedicated manager |

---

## 5.3 Milestones

```
Conversions:  1         5          10          25         100
              │         │          │           │          │
              ▼         ▼          ▼           ▼          ▼
Milestone:  First    High-5    Perfect-10   Quarter    Century
Reward:     Badge     €25        €50+Badge    €100      €500
```

| Milestone | Code | Threshold | Reward Type | Reward |
|-----------|------|-----------|-------------|--------|
| First Blood | `first_blood` | 1 | Badge | "Starter" badge |
| High Five | `high_five` | 5 | Cash | €25 |
| Perfect 10 | `perfect_10` | 10 | Cash + Badge | €50 + "Pro" |
| Quarter Century | `quarter_century` | 25 | Cash + Badge | €100 + "Elite" |
| Century Club | `century_club` | 100 | Cash + Badge | €500 + "Legend" |

---

## 5.4 Leaderboard

```
┌─────────────────────────────┐
│  🏆 Top Referrers           │
├─────────────────────────────┤
│  #1  Anna M.    32 referrals│
│  #2  John D.    28 referrals│
│  #3  Sarah K.   24 referrals│
│  ...                        │
│  #42 You       3 referrals │
└─────────────────────────────┘
```

| Field | Code | Options |
|-------|------|---------|
| Enabled | `enabled` | true/false |
| Ranking by | `ranking_metric` | `conversions`, `revenue`, `referrals` |
| Show count | `display_count` | 5, 10, 20 |
| Period | `period` | `all_time`, `monthly`, `weekly` |
| Anonymize | `anonymize` | true/false ("J***n") |
| Show own rank | `show_own_rank` | true/false |

---

## 5.5 Recurring Commission

```
Month 1    Month 2    Month 3    Month 4    ...    Month 12
   │          │          │          │                 │
   ▼          ▼          ▼          ▼                 ▼
  €10        €10        €10        €10              €10
   │          │          │          │                 │
   └──────────┴──────────┴──────────┴─────...────────┘
                         │
                    Total: €120
```

| Field | Code | Options |
|-------|------|---------|
| Rate | `recurring_rate` | 10%, 15%, 20% |
| Duration | `recurring_duration` | `12_months`, `24_months`, `lifetime` |
| Stops if | `recurring_stops_if` | `invitee_churns`, `participant_churns` |

---

# 6. Plan Eligibility & Reward Rules

## The Problem: Wrong Plan Conversion

**Scenario:** Reward triggers on "Silver plan", but invitee buys "Basic plan"

### Configuration Options

| Field | Code | Description |
|-------|------|-------------|
| `eligible_plans` | `["silver", "gold", "enterprise"]` | Plans that trigger reward |
| `min_plan` | `silver` | Minimum plan level |
| `any_paid_plan` | `true` | Any paid plan triggers |

### What Happens?

| Invitee Action | Config: `any_paid_plan` | Config: `min_plan: silver` |
|----------------|-------------------------|----------------------------|
| Buys Basic (€9) | ✅ Reward triggered | ❌ No reward |
| Buys Silver (€29) | ✅ Reward triggered | ✅ Reward triggered |
| Buys Gold (€99) | ✅ Reward triggered | ✅ Reward triggered |
| Upgrades Basic→Silver | ✅ Already rewarded | ✅ Reward NOW triggered |

### Upgrade Handling

| Field | Code | Behavior |
|-------|------|----------|
| `reward_on_upgrade` | `true` | Trigger reward when upgrading to eligible plan |
| `upgrade_window` | `30_days` | Only if upgrade within 30 days |

### Example Configuration

```json
{
  "conversion_trigger": "subscription",
  "eligible_plans": ["silver", "gold", "enterprise"],
  "reward_on_upgrade": true,
  "upgrade_window_days": 30
}
```

**Result:**
- Invitee buys Basic → No reward yet
- Invitee upgrades to Silver within 30 days → Reward triggered
- Invitee upgrades to Silver after 30 days → No reward (window closed)

---

# 7. Tracking Glossary

## Attribution

| Term | Code Name | Definition |
|------|-----------|------------|
| **Attribution** | `attribution` | Crediting conversion to participant |
| **First-Touch** | `first_touch` | First participant gets credit |
| **Last-Touch** | `last_touch` | Last participant gets credit |
| **Attribution Window** | `attribution_window` | Days cookie is valid (30/60/90) |

## Tracking Events

| Term | Code Name | Definition | Triggers Reward? |
|------|-----------|------------|------------------|
| **Click** | `click` | Link clicked | No |
| **Signup** | `signup` | Account created | Configurable |
| **Trial Start** | `trial_start` | Trial activated | Configurable |
| **Purchase** | `purchase` | First payment | Usually yes |
| **Subscription** | `subscription` | Recurring started | Usually yes |
| **Upgrade** | `upgrade` | Plan upgraded | Configurable |
| **Renewal** | `renewal` | Subscription renewed | For recurring |

## Conversion Trigger

| Term | Code Name | Definition |
|------|-----------|------------|
| **Conversion Event** | `conversion_event` | Event that triggers reward |

Common configurations:

| Business Model | Recommended Trigger |
|----------------|---------------------|
| Freemium SaaS | `purchase` (first payment) |
| Free Trial SaaS | `subscription` (after trial) |
| One-time Purchase | `purchase` |
| Usage-based | `purchase` with min amount |

---

# 8. Link & Code Glossary

| Term | Code Name | Definition | Example |
|------|-----------|------------|---------|
| **Referral Link** | `referral_link` | Trackable URL | `app.com/r/JOHN123` |
| **Referral Code** | `referral_code` | Unique identifier | `JOHN123` |
| **Short Link** | `short_link` | Shortened URL | `ref.co/abc` |
| **Vanity Code** | `vanity_code` | Custom chosen code | `JOHNDOE` |
| **Discount Code** | `discount_code` | Code for beneficiary discount | `SAVE20` |

### Link Structure

```
https://app.com/signup?ref=JOHN123&utm_source=referral
        ───────────────  ────────  ─────────────────────
        Base URL         Code      UTM tracking
```

---

# 9. Payout Glossary

| Term | Code Name | Definition |
|------|-----------|------------|
| **Balance** | `balance` | Unpaid rewards total |
| **Pending Balance** | `pending_balance` | Not yet approved |
| **Available Balance** | `available_balance` | Ready to withdraw |
| **Payout** | `payout` | Transfer to participant |
| **Threshold** | `payout_threshold` | Minimum to withdraw (€50) |

## Payout Status

| Term | Code Name | Definition |
|------|-----------|------------|
| **Requested** | `requested` | Participant requested payout |
| **Processing** | `processing` | Being processed |
| **Completed** | `completed` | Successfully sent |
| **Failed** | `failed` | Payment failed |

---

# 10. Fraud Glossary

| Term | Code Name | Definition |
|------|-----------|------------|
| **Self-Referral** | `self_referral` | Referring yourself (blocked) |
| **Duplicate** | `duplicate` | Same person referred twice |
| **Velocity** | `velocity` | Too many too fast |
| **Risk Score** | `risk_score` | Fraud probability (0-100) |
| **Flagged** | `flagged` | Marked for review |
| **Blocked** | `blocked` | Rejected as fraud |

---

# 11. Widget & SDK Glossary

| Term | Code Name | Definition |
|------|-----------|------------|
| **Widget** | `widget` | Embeddable UI component |
| **SDK** | `sdk` | JavaScript library |
| **Embed Code** | `embed_code` | Script snippet for client |
| **Config** | `config` | Widget settings from CDN |

## Widget Types

| Term | Code Name | Definition |
|------|-----------|------------|
| **Floating** | `floating` | Button in corner, opens modal |
| **Inline** | `inline` | Embedded in page |
| **Modal** | `modal` | Popup overlay |
| **Sidebar** | `sidebar` | Side panel |

---

# 12. API & Integration Glossary

| Term | Code Name | Definition |
|------|-----------|------------|
| **API Key** | `api_key` | Client's secret key |
| **Public Key** | `public_key` | Key for SDK (ok to expose) |
| **Webhook** | `webhook` | Event notification to client |
| **Callback** | `callback` | Response from integration |

---

# 13. Sharing & Notifications

## Sharing Channels

| Term | Code Name | Priority |
|------|-----------|----------|
| **Email** | `email` | MVP |
| **WhatsApp** | `whatsapp` | MVP (DACH critical) |
| **LinkedIn** | `linkedin` | MVP (B2B essential) |
| **Twitter/X** | `twitter` | MVP |
| **Facebook** | `facebook` | V1.1 |
| **SMS** | `sms` | V1.1 |
| **Direct/Copy** | `direct` | MVP |
| **QR Code** | `qr_code` | MVP |

## Notification Types

| Term | Code Name | Trigger |
|------|-----------|---------|
| **Welcome** | `welcome` | Joins program |
| **Referral Sent** | `referral_sent` | Shares link |
| **Click Received** | `click_received` | Link clicked |
| **Signup Received** | `signup_received` | Invitee signs up |
| **Conversion** | `conversion` | Invitee converts |
| **Reward Earned** | `reward_earned` | Reward credited |
| **Milestone Reached** | `milestone_reached` | Hit milestone |
| **Payout Sent** | `payout_sent` | Money transferred |
| **Rank Changed** | `rank_changed` | Leaderboard position |

---

# 14. Quick Reference

## Actor Flow Summary

| Stage | Actor Term | Status | Trigger |
|-------|------------|--------|---------|
| 1 | User | - | Has account |
| 2 | Participant | `pending` | Joins program |
| 3 | Participant | `active` | Shares link |
| 4 | Participant | `successful` | Gets conversion |

| Stage | Actor Term | Status | Trigger |
|-------|------------|--------|---------|
| 1 | Unknown | - | - |
| 2 | Invitee | `clicked` | Clicks link |
| 3 | Invitee | `signed_up` | Creates account |
| 4 | Converted | `converted` | Pays |
| 5 | Beneficiary | - | Gets reward (two-sided) |

## Reward Flow Summary

| Stage | Reward Status | Trigger |
|-------|---------------|---------|
| 1 | `pending` | Conversion happens |
| 2 | `approved` | Pending period passes |
| 3 | `paid` | Payout processed |

| Alternative | Reward Status | Trigger |
|-------------|---------------|---------|
| A | `held` | Fraud flagged |
| B | `revoked` | Refund or fraud confirmed |
| C | `expired` | Not claimed in time |

---

---

**Document Version:** 1.0  
**Total Terms Defined:** 180+  
**Use For:** Code, API, Documentation, Team Communication
