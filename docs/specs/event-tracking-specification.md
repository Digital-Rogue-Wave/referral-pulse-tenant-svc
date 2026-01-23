# Event Tracking Specification
## Referral Marketing SaaS Platform

**Version:** 2.0  
**Created:** December 2024  
**Updated:** December 2024  
**Purpose:** Define exactly how each event is tracked, what data is needed, and where it comes from

---

# Glossary

| Term | Definition |
|------|------------|
| **Visitor** | Anonymous person who clicked a referral link but hasn't signed up yet. Identified only by visitor_id (UUID). |
| **Referrer** | Existing customer who shares referral links. Has email, account, referrer_id. |
| **Referee** | Person who signed up through a referral. Was a visitor, now identified user. |
| **Attribution** | Process of matching a signup/conversion back to the referrer who generated the click. |
| **IP Hash** | SHA-256 hash of visitor's IP address. Used for fraud detection (same IP = suspicious) without storing raw IP (GDPR). |
| **Referer URL** | HTTP header sent by browser showing where click came from (linkedin.com, twitter.com, email client). Used for channel analytics. |
| **First-party Cookie** | Cookie set on customer's domain (client.shop.com), not ours. Better privacy, not blocked by browsers. |
| **Click ID** | Unique identifier for a click event. Cookie stores click_id as pointer; all data lives in our database. |

---

# SDK Architecture

## Two Different Things on CDN

| What | Where Hosted | Updated When | Shared |
|------|--------------|--------------|--------|
| **SDK Code** (JavaScript) | `https://sdk.referralapp.io/v1.js` | Only when we release new SDK version | Same file for all clients |
| **Campaign Config** (JSON) | `https://cdn.referralapp.io/config/{tenant_id}/{campaign_id}.json` | When client changes campaign settings | Per-tenant, per-campaign |

**SDK code is static and shared.** We don't update CDN when one of 1000 clients pauses a campaign.

**Campaign config is dynamic and per-client.** Updated and cache-invalidated when client changes settings.

## Runtime Flow

1. SDK code loads (same JavaScript for everyone)
2. SDK reads `data-tenant` and `data-campaign` from script tag
3. SDK fetches config JSON for that tenant/campaign
4. Config contains: status, A/B variants, rewards, copy, colors, segment rules
5. SDK renders widget based on config

## When Client Pauses Campaign

1. Client clicks "Pause" in dashboard
2. Backend updates campaign status in database
3. Backend regenerates config JSON
4. Backend invalidates CDN cache for that config URL
5. Next SDK load fetches fresh config → sees "paused" → hides widget

**SDK code unchanged. Only config JSON updated.**

## Campaign Config Structure

```json
{
  "campaign_id": "cmp_xxx",
  "status": "active",
  "rewards": {
    "referrer": { "type": "percentage", "value": 10 },
    "referee": { "type": "fixed", "value": 20, "currency": "EUR" }
  },
  "ab_test": {
    "enabled": true,
    "variants": [
      { "id": "A", "weight": 50, "reward_value": 10 },
      { "id": "B", "weight": 50, "reward_value": 15 }
    ]
  },
  "widget": {
    "colors": { "primary": "#4F46E5" },
    "copy": { "title": "Invite friends, earn rewards" }
  },
  "segment_rules": []
}
```

---

# A/B Testing & Segmentation

## A/B Testing

**We handle internally. Customer does nothing.**

- Customer creates campaign with variants in dashboard (A: 10% reward, B: 20% reward)
- Our API assigns visitor to variant (random or by visitor_id hash)
- SDK receives which variant to show from config
- Results shown in dashboard ("Variant B converts 15% better")

## Segmentation

**Problem:** We don't know customer's user attributes (plan, tenure, activity). Customer does.

| Approach | How It Works |
|----------|--------------|
| **Customer controls visibility** (simpler) | Customer decides when to show widget in their code. We never see users who don't qualify. |
| **Customer passes attributes** (more powerful) | Customer sends user attributes during SDK init. We evaluate segment rules and return show/hide decision. |

### Option A: Customer Controls Visibility

Customer shows/hides widget based on their own logic:

```javascript
// Customer's code - they decide who sees widget
if (user.plan === 'pro' && user.tenure_days > 30) {
  ReferralApp.showWidget();
}
```

### Option B: Customer Passes Attributes

Customer passes user attributes, we decide:

```javascript
ReferralApp.init({
  tenantId: 'ten_xxx',
  user: {
    email: 'alice@example.com',
    userId: 'usr_123'
  },
  attributes: {
    plan: 'pro',
    tenure_days: 45,
    total_spent: 500,
    country: 'DE'
  }
});
// SDK evaluates segment rules from config, shows/hides accordingly
```

---

# Campaign State Handling

## SDK Behavior by Campaign Status

| Status | SDK Behavior |
|--------|--------------|
| **active** | Show widget normally, track clicks |
| **paused** | Hide widget OR show "Program paused" message. No new clicks tracked. |
| **ended** | Hide widget OR show "Program ended" message. No new clicks tracked. |
| **draft** | Never shown |

## In-Flight Attribution (Clicks Before State Change)

| Scenario | Handling |
|----------|----------|
| Click when active, signup when paused | **Honor it** - click was valid at the time |
| Click when active, signup when ended (within grace period) | **Honor it** - grace period (e.g., 7 days) |
| Click when active, signup when ended (past grace) | **Reject** - too late |
| Click after pause/end | **Should not happen** - SDK doesn't track clicks for inactive campaigns |

**Validation happens server-side at signup, not in SDK.**

## Config Caching & Freshness

| Approach | Latency | Freshness |
|----------|---------|-----------|
| CDN cached config | Fast (ms) | Stale up to cache TTL |
| API call every load | Slow | Always fresh |
| **CDN + cache invalidation** (recommended) | Fast | Fresh after invalidation |

When admin pauses campaign → we invalidate CDN cache → next SDK load gets fresh config.

---

# Executive Summary

## Integration Methods Overview

| Method | Reliability | Effort | Use Case |
|--------|-------------|--------|----------|
| **Server-to-Server API** | 🥇 Highest | Medium (dev work) | Signup, Conversion, Subscription events |
| **Payment Webhooks** | 🥇 Highest | Low (config only) | Payment, Renewal, Upgrade, Downgrade |
| **SDK Client Calls** | 🥈 Medium | Low | Click tracking, Widget interactions, Invitations |

## Honest Integration Timeline

| Scenario | Time | Who |
|----------|------|-----|
| Configure new campaign (existing integration) | 5-15 min | Marketing |
| Basic SDK integration (widget + click tracking) | 1-2 hours | Developer |
| Full server-side integration | 4-8 hours | Developer |
| Enterprise integration with custom requirements | 1-3 days | Developer |

---

# Event Tracking Matrix

## Quick Reference

| Event | Tracking Method | Required Data | Source of Data |
|-------|-----------------|---------------|----------------|
| **Click** | SDK (automatic) | visitor_id, referrer_id | URL params + generated |
| **Invitation Sent** | SDK client call | referrer_id, channel, recipient_email | SDK + user input |
| **Signup** | Server-to-Server API | email, visitor_id, referral_code | Customer backend |
| **Conversion** | Payment Webhook | stripe_customer_id, amount | Stripe |
| **Renewal** | Payment Webhook | stripe_subscription_id | Stripe |
| **Upgrade** | Payment Webhook | stripe_subscription_id, new_plan | Stripe |
| **Downgrade** | Payment Webhook | stripe_subscription_id, new_plan | Stripe |
| **Churn** | Payment Webhook | stripe_subscription_id | Stripe |
| **Refund** | Payment Webhook | stripe_charge_id, amount | Stripe |

---

# Detailed Event Specifications

## 1. CLICK EVENT

**Tracking Method:** SDK (Automatic)  
**Reliability:** High (browser-based but automatic)

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLICK TRACKING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Referrer shares link: https://r.referralapp.io/abc123                   │
│                                                                              │
│  2. Visitor clicks link                                                     │
│     └── Request hits our redirect service                                   │
│                                                                              │
│  3. Our Server (before redirect):                                           │
│     ├── Lookup link "abc123" → get campaign_id, referrer_id, destination    │
│     ├── Generate click_id (UUID)                                            │
│     ├── Generate visitor_id (if not in cookie)                              │
│     ├── Record ClickEvent in database:                                      │
│     │   {                                                                   │
│     │     click_id: "clk_xxx",                                              │
│     │     link_id: "abc123",                                                │
│     │     campaign_id: "cmp_xxx",                                           │
│     │     referrer_id: "ref_xxx",                                           │
│     │     visitor_id: "vid_xxx",                                            │
│     │     ip_hash: "sha256(ip)",                                            │
│     │     user_agent: "...",                                                │
│     │     referer_url: "linkedin.com",                                      │
│     │     country: "DE",                                                    │
│     │     clicked_at: "2024-01-15T10:00:00Z"                                │
│     │   }                                                                   │
│     └── 302 Redirect to: destination_url?_rai=vid_xxx&_rac=clk_xxx          │
│                                                                              │
│  4. Browser lands on customer site (client.shop.com)                        │
│     └── SDK script loads and:                                               │
│         ├── Reads URL params (_rai, _rac)                                   │
│         ├── Creates first-party cookie on client.shop.com                   │
│         │   {                                                               │
│         │     vid: "vid_xxx",                                               │
│         │     ft_clk: "clk_xxx",                                            │
│         │     ft_at: 1705312800                                             │
│         │   }                                                               │
│         └── Cleans URL (removes tracking params)                            │
│                                                                              │
│  NO CUSTOMER CODE REQUIRED FOR CLICK TRACKING                               │
│  (Just SDK script on page)                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Collected

| Field | Source | Required |
|-------|--------|----------|
| click_id | Generated by us | Auto |
| visitor_id | Generated or from cookie | Auto |
| link_id | From URL path | Auto |
| campaign_id | Lookup from link | Auto |
| referrer_id | Lookup from link | Auto |
| ip_hash | Request IP (hashed for privacy) | Auto |
| user_agent | Request header | Auto |
| referer_url | Request header | Auto |
| country/city | GeoIP lookup | Auto |
| utm_* | URL query params | Auto |

### Customer Integration

```html
<!-- Just add SDK script - click tracking is automatic -->
<script src="https://sdk.referralapp.io/v1.js" data-tenant="ten_xxx"></script>
```

---

## 2. INVITATION SENT EVENT

**Tracking Method:** SDK Client Call  
**Reliability:** Medium (depends on user action completing)

### Critical: How SDK Knows the Referrer

**The SDK cannot magically know who the logged-in user is. Customer must tell us.**

When customer initializes our SDK, they must pass their current user's identity:

| Data Customer Provides | Why We Need It |
|------------------------|----------------|
| User email | Match to existing referrer or create new one |
| User ID (their system) | Link referrer to their user |
| User name (optional) | Display in widget, personalization |

### The Flow

```
Customer's App (logged-in area)
        │
        ▼
Customer's frontend knows: "Current user is alice@company.com, ID: usr_123"
        │
        ▼
Customer passes this to SDK during initialization
        │
        ▼
SDK calls our API: "Get or create referrer for alice@company.com"
        │
        ▼
API returns referrer_id
        │
        ▼
Widget now knows who the referrer is → can show their link, track invitations
```

### Customer Integration (Required)

```javascript
// Customer MUST initialize SDK with user identity in logged-in area
ReferralApp.init({
  tenantId: 'ten_xxx',
  campaignId: 'cmp_xxx',
  user: {
    email: 'alice@example.com',     // Required
    userId: 'usr_123',               // Required
    name: 'Alice Smith'              // Optional
  }
});
```

**Without this initialization, widget cannot function.** We don't know who the referrer is.

### How Invitation Tracking Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INVITATION TRACKING FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  0. Customer initializes SDK with user identity (see above)                 │
│     └── SDK now knows referrer_id                                           │
│                                                                              │
│  1. Referrer opens widget in customer's app                                 │
│                                                                              │
│  2. Referrer chooses to share via:                                          │
│     ├── Email (enters recipient email)                                      │
│     ├── LinkedIn (share dialog)                                             │
│     ├── WhatsApp (share dialog)                                             │
│     ├── Twitter/X (share dialog)                                            │
│     └── Copy link (clipboard)                                               │
│                                                                              │
│  3. SDK captures share action:                                              │
│     ├── For email: SDK sends invite via our email service                   │
│     ├── For social: SDK opens native share dialog, tracks intent            │
│     └── For copy: SDK tracks copy action                                    │
│                                                                              │
│  4. SDK sends event to our API:                                             │
│     POST https://t.referralapp.io/event                                     │
│     {                                                                       │
│       event: "invitation_sent",                                             │
│       tenant_id: "ten_xxx",                                                 │
│       referrer_id: "ref_xxx",      // Known from initialization             │
│       channel: "email",                                                     │
│       recipient_email: "friend@example.com",                                │
│       link_url: "https://r.referralapp.io/abc123",                          │
│       timestamp: "2024-01-15T10:00:00Z"                                     │
│     }                                                                       │
│                                                                              │
│  AUTOMATIC after SDK initialization with user identity                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Collected

| Field | Source | Required |
|-------|--------|----------|
| referrer_id | From SDK initialization (customer provides user) | Yes |
| channel | Widget UI selection | Yes |
| recipient_email | User input (email only) | For email |
| link_url | Generated referral link | Auto |
| message | User customization (optional) | No |

---

## 3. SIGNUP EVENT ⭐ Critical

**Tracking Method:** Server-to-Server API (Recommended)  
**Reliability:** Highest

### Why Server-to-Server?

| Method | Problem |
|--------|---------|
| Auto-detect signup | ❌ Impossible - every site is different |
| SDK client call | ⚠️ Ad blockers, user closes tab before it fires |
| Server-to-server | ✅ Reliable, tamper-proof, happens after DB commit |

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SIGNUP TRACKING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Visitor fills signup form on client.shop.com                            │
│                                                                              │
│  2. Form submits to customer's backend                                      │
│     └── Customer's frontend passes attribution data:                        │
│         - visitor_id (from our cookie)                                      │
│         - referral_code (if entered in form)                                │
│                                                                              │
│  3. Customer's backend creates user in THEIR database                       │
│     └── This is their normal signup flow - we don't interfere               │
│                                                                              │
│  4. AFTER successful user creation, customer's backend calls our API:       │
│                                                                              │
│     POST https://api.referralapp.io/v1/track/signup                         │
│     Headers:                                                                │
│       Authorization: Bearer sk_live_xxx                                     │
│       Content-Type: application/json                                        │
│     Body:                                                                   │
│       {                                                                     │
│         "email": "newuser@example.com",      // Required                    │
│         "external_user_id": "usr_12345",     // Their user ID               │
│         "visitor_id": "vid_xxx",             // From cookie (optional)      │
│         "referral_code": "FRIEND20",         // If used (optional)          │
│         "metadata": {                        // Optional extra data         │
│           "plan": "free",                                                   │
│           "source": "web"                                                   │
│         }                                                                   │
│       }                                                                     │
│                                                                              │
│  5. Our API processes signup:                                               │
│     ├── Match visitor_id → find click → get campaign_id, referrer_id        │
│     ├── OR match referral_code → get referrer_id                            │
│     ├── Validate campaign is still active (or within grace period)          │
│     ├── Check cookie duration hasn't expired                                │
│     ├── Run fraud checks                                                    │
│     ├── Create Referral record (status: signed_up)                          │
│     └── Return referral_id to customer                                      │
│                                                                              │
│  6. Response:                                                               │
│     {                                                                       │
│       "success": true,                                                      │
│       "referral_id": "ref_xxx",                                             │
│       "attributed": true,                                                   │
│       "referrer_id": "ref_yyy",                                             │
│       "campaign_id": "cmp_xxx"                                              │
│     }                                                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Required

| Field | Source | Required | Notes |
|-------|--------|----------|-------|
| email | Customer's signup form | **Yes** | Used for deduplication, matching |
| external_user_id | Customer's database | Recommended | Links their user to our referral |
| visitor_id | Cookie (_rai_vid) | Optional* | Primary attribution method |
| referral_code | Signup form input | Optional* | Fallback attribution |
| metadata | Customer's data | No | Plan, source, custom fields |

*At least one of visitor_id or referral_code needed for attribution

### Customer Integration (Backend)

```javascript
// Node.js Example
const ReferralApp = require('@referralapp/node');
const client = new ReferralApp({ apiKey: 'sk_live_xxx' });

app.post('/api/signup', async (req, res) => {
  // 1. Your normal signup logic
  const user = await db.users.create({
    email: req.body.email,
    password: hashPassword(req.body.password),
    name: req.body.name
  });
  
  // 2. Track signup with ReferralApp (AFTER your DB commit)
  try {
    await client.track.signup({
      email: user.email,
      externalUserId: user.id,
      visitorId: req.body.visitorId,      // From frontend
      referralCode: req.body.referralCode  // From signup form
    });
  } catch (err) {
    // Don't fail signup if tracking fails
    console.error('Referral tracking failed:', err);
  }
  
  res.json({ success: true, user });
});
```

```python
# Python Example
import referralapp

client = referralapp.Client(api_key='sk_live_xxx')

@app.route('/api/signup', methods=['POST'])
def signup():
    # 1. Your normal signup logic
    user = User.create(
        email=request.json['email'],
        password=hash_password(request.json['password'])
    )
    db.session.commit()
    
    # 2. Track signup with ReferralApp
    try:
        client.track.signup(
            email=user.email,
            external_user_id=str(user.id),
            visitor_id=request.json.get('visitor_id'),
            referral_code=request.json.get('referral_code')
        )
    except Exception as e:
        app.logger.error(f'Referral tracking failed: {e}')
    
    return jsonify({'success': True})
```

### Customer Integration (Frontend - Get Attribution Data)

```javascript
// Get attribution data from SDK to pass to your backend
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  
  // Get attribution data from our SDK
  const attribution = window.ReferralApp?.getAttribution() || {};
  
  // Include in your signup request
  const response = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: formData.get('email'),
      password: formData.get('password'),
      name: formData.get('name'),
      referralCode: formData.get('referral_code'),  // If you have a field
      visitorId: attribution.visitorId               // From our SDK
    })
  });
});
```

### Confirmed vs Unconfirmed Signup

| Strategy | Track When | Pros | Cons |
|----------|------------|------|------|
| **Unconfirmed** | Form submit | More referrals counted | Fake signups, spam abuse |
| **Confirmed** (recommended) | Email verified | Real users only | Delay, some never confirm |
| **Both** | Two events | Full funnel visibility | More complexity |

**Recommendation:** Track confirmed signup only. Referrer gets credit for real users, not spam.

### Alternatives to Backend Cookie Parsing

Asking customer to parse our cookie in their backend is friction. Alternatives:

| Approach | How | Burden |
|----------|-----|--------|
| SDK hidden field | SDK auto-injects visitor_id into signup form | Medium |
| URL parameter passthrough | visitor_id stays in URL through signup flow | Low but ugly |
| **Email matching only** | We match by email, no visitor_id needed | **Lowest** |

**Email matching approach:**
- Customer only sends us: email + their user ID
- We match email to any pending referral (from click that landed on same email)
- Works if visitor uses same email for click landing page and signup
- Less accurate but zero cookie work for customer

### Auth Provider Integration (Keycloak, Zitadel, Auth0)

If customer uses external auth providers, these providers send **webhooks** on user events.

| Provider | Webhook Event | What We Receive |
|----------|---------------|-----------------|
| Auth0 | `user.created` | email, user_id, metadata |
| Keycloak | `REGISTER` | email, user_id, attributes |
| Zitadel | `user.human.added` | email, user_id |

**Integration:**
1. Customer configures webhook in their auth provider pointing to us
2. Auth provider sends user.created event
3. We receive email + user_id
4. We match by email to pending referral

**Challenge:** How to get visitor_id into auth provider?

| Option | How |
|--------|-----|
| Custom field in registration | Customer adds visitor_id as custom registration field |
| User metadata | Customer stores visitor_id in user metadata during registration flow |
| **Email match only** | We match by email (fallback, less accurate) |
| Referral code field | Customer adds referral code input to registration form |

---

## Alternative Integration Patterns (No Backend Code)

Backend changes require dev, QA, deployment. Days or weeks in many companies.

### Zero-Code Options

| If Customer Uses... | Integration Method | Code Required |
|--------------------|-------------------|---------------|
| **Segment** | Add us as destination | None (config) |
| **Auth0** | Configure webhook | None (config) |
| **Keycloak** | Configure webhook | None (config) |
| **Zitadel** | Configure webhook | None (config) |
| **Stripe** | Connect OAuth + we watch customer.created | None (config) |
| **Zapier** | Create Zap from their DB/CRM | None (config) |
| **Make (Integromat)** | Create scenario | None (config) |
| None of the above | Backend API call | **Yes** |

### Segment Integration (V1.1)

If customer already sends events to Segment, we become a Segment destination.

- Customer already tracks `identify` and `track` events
- They add us as destination in Segment dashboard
- We receive user signups automatically
- **Zero code change for customer**

### Auth Provider Webhook (V1.1)

- Customer configures webhook URL in Auth0/Keycloak/Zitadel dashboard
- On each new user registration, provider sends us webhook
- We match by email
- **Config only, no code**

### Zapier/Make Integration (V1.2)

- Customer creates automation: "New user in DB → send to ReferralApp"
- Triggers from their database, CRM, or any connected app
- **No code, just drag-and-drop**

### Sidecar Pattern (Not Recommended)

Sidecar = separate container running alongside their app that intercepts traffic.

| Pros | Cons |
|------|------|
| No code change in their app | Requires infrastructure access (K8s, Docker) |
| | Must understand their request format |
| | Security concerns (we see their traffic) |
| | Still needs deployment |

**Verdict:** Too complex. Segment or auth webhooks are better.

---

## AI Integration Assistance (V1.1)

### What AI Can Help With

| Feature | How It Helps | Priority |
|---------|--------------|----------|
| Code snippet generation | AI generates integration code for customer's stack | V1.1 |
| Integration assistant chatbot | "How do I integrate with Next.js + Auth0?" → AI answers | V1.1 |
| Auto-detect tech stack | AI analyzes customer's website, suggests integration path | V1.2 |
| Debug assistant | Customer pastes error, AI diagnoses | V1.2 |
| Webhook payload builder | AI helps configure auth provider webhooks | V1.1 |

### AI Integration Flow

1. Customer enters their website URL
2. AI analyzes: detects Next.js, Stripe, Auth0
3. AI generates specific instructions for that stack
4. AI provides copy-paste snippets
5. Customer asks follow-up questions in chat

### What AI Cannot Do

| Task | Possible? |
|------|-----------|
| Generate code snippets | ✅ Yes |
| Answer integration questions | ✅ Yes |
| Detect framework from URL | ✅ Yes |
| Write code directly into customer's repo | ❌ No |
| Access customer's codebase | ❌ No |
| Deploy changes for customer | ❌ No |

**AI reduces integration time but doesn't eliminate it.**

---

## 4. CONVERSION/PAYMENT EVENT ⭐ Critical

**Tracking Method:** Payment Webhook (Stripe/Paddle)  
**Reliability:** Highest

### Why Payment Webhooks?

1. **100% Accurate** - Payment provider confirms money received
2. **No Customer Code** - Just connect Stripe account
3. **Tamper-Proof** - User can't fake a payment
4. **Handles Edge Cases** - Failed payments, 3D Secure, etc.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CONVERSION TRACKING FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SETUP (One-time):                                                          │
│  ─────────────────                                                          │
│  1. Customer connects Stripe account in our dashboard                       │
│     └── OAuth flow → we get access to their Stripe webhooks                 │
│                                                                              │
│  2. We register webhook endpoint in their Stripe:                           │
│     └── https://webhooks.referralapp.io/stripe/{tenant_id}                  │
│                                                                              │
│  3. Customer ensures referral data on Stripe Customer:                      │
│     └── When creating Stripe Customer, include referral_id in metadata      │
│                                                                              │
│                                                                              │
│  PAYMENT FLOW:                                                              │
│  ─────────────                                                              │
│  1. Referred user makes payment on client.shop.com                          │
│                                                                              │
│  2. Customer's backend creates/charges Stripe:                              │
│     ┌──────────────────────────────────────────────────────────────────┐   │
│     │  // When creating Stripe Customer (at signup or first payment)   │   │
│     │  const customer = await stripe.customers.create({                │   │
│     │    email: user.email,                                            │   │
│     │    metadata: {                                                   │   │
│     │      referral_id: referralResponse.referral_id,  // From signup  │   │
│     │      referralapp_visitor_id: visitorId                           │   │
│     │    }                                                             │   │
│     │  });                                                             │   │
│     └──────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  3. Stripe processes payment successfully                                   │
│                                                                              │
│  4. Stripe sends webhook to us:                                             │
│     POST https://webhooks.referralapp.io/stripe/ten_xxx                     │
│     Event: checkout.session.completed                                       │
│     {                                                                       │
│       "type": "checkout.session.completed",                                 │
│       "data": {                                                             │
│         "object": {                                                         │
│           "id": "cs_xxx",                                                   │
│           "customer": "cus_xxx",                                            │
│           "amount_total": 9900,                                             │
│           "currency": "eur",                                                │
│           "metadata": {...},                                                │
│           "subscription": "sub_xxx"                                         │
│         }                                                                   │
│       }                                                                     │
│     }                                                                       │
│                                                                              │
│  5. Our webhook handler:                                                    │
│     ├── Verify webhook signature                                            │
│     ├── Fetch Stripe Customer → get metadata.referral_id                    │
│     ├── Lookup Referral by referral_id or visitor_id                        │
│     ├── If found:                                                           │
│     │   ├── Update Referral status: signed_up → converted                   │
│     │   ├── Calculate reward based on campaign rules                        │
│     │   ├── Create Reward record                                            │
│     │   └── Queue for AI approval                                           │
│     └── Store payment details for recurring tracking                        │
│                                                                              │
│  CUSTOMER CODE: Minimal - just add metadata to Stripe Customer              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Stripe Events We Listen For

| Event | What It Means | Our Action |
|-------|---------------|------------|
| `checkout.session.completed` | Payment successful | Create conversion, calculate reward |
| `customer.subscription.created` | New subscription | Link to referral, start recurring tracking |
| `invoice.paid` | Recurring payment | Process recurring reward |
| `customer.subscription.updated` | Plan change | Detect upgrade/downgrade |
| `customer.subscription.deleted` | Cancellation | Update churn status, stop recurring |
| `charge.refunded` | Refund issued | Adjust/claw back reward |

### Data Flow

```
Stripe Event
    │
    ├── customer_id (cus_xxx)
    │   └── Lookup customer → get metadata.referral_id
    │
    ├── amount_total
    │   └── Used for commission calculation
    │
    ├── subscription_id (if subscription)
    │   └── Track for recurring rewards
    │
    └── currency
        └── Convert to tenant's default currency
```

### Customer Integration

```javascript
// When creating Stripe Customer (signup or first payment)
// This is the ONLY code change needed for conversion tracking

const customer = await stripe.customers.create({
  email: user.email,
  name: user.name,
  metadata: {
    // Add referral data from our signup API response
    referralapp_referral_id: referralResponse?.referral_id || '',
    referralapp_visitor_id: visitorId || ''
  }
});

// Or update existing customer
await stripe.customers.update(customerId, {
  metadata: {
    referralapp_referral_id: referralResponse.referral_id
  }
});
```

### Alternative: Server-Side API for Non-Stripe

```javascript
// If not using Stripe, call our API directly after payment

app.post('/webhook/payment-provider', async (req, res) => {
  const payment = req.body;
  
  // Your payment processing logic
  await processPayment(payment);
  
  // Track conversion with us
  await client.track.conversion({
    email: payment.customer_email,
    externalUserId: payment.customer_id,
    type: 'purchase',
    value: payment.amount,
    currency: payment.currency,
    orderId: payment.order_id,
    isRecurring: payment.is_subscription
  });
  
  res.json({ received: true });
});
```

---

## 5. RENEWAL EVENT (Recurring Payments)

**Tracking Method:** Payment Webhook (Automatic)  
**Reliability:** Highest

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RENEWAL TRACKING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Stripe bills customer on renewal date                                   │
│                                                                              │
│  2. Stripe sends webhook:                                                   │
│     Event: invoice.paid                                                     │
│     {                                                                       │
│       "type": "invoice.paid",                                               │
│       "data": {                                                             │
│         "object": {                                                         │
│           "subscription": "sub_xxx",                                        │
│           "customer": "cus_xxx",                                            │
│           "amount_paid": 9900,                                              │
│           "billing_reason": "subscription_cycle"  // Key indicator          │
│         }                                                                   │
│       }                                                                     │
│     }                                                                       │
│                                                                              │
│  3. Our handler:                                                            │
│     ├── Check billing_reason === "subscription_cycle" (renewal)             │
│     ├── Lookup subscription → get original referral                         │
│     ├── Check if referral has active recurring rewards                      │
│     ├── If yes:                                                             │
│     │   ├── Calculate recurring reward                                      │
│     │   └── Create Reward record (parent: original reward)                  │
│     └── Update subscription tracking data                                   │
│                                                                              │
│  FULLY AUTOMATIC - No customer code                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Invoice Billing Reasons

| billing_reason | Meaning | Our Action |
|----------------|---------|------------|
| `subscription_create` | First payment | Already handled in conversion |
| `subscription_cycle` | Renewal | Process recurring reward |
| `subscription_update` | Mid-cycle proration | Check for upgrade/downgrade |
| `manual` | Manual invoice | Treat as one-time |

### Customer Integration

**None required** - Once Stripe is connected and initial referral is tracked, renewals are automatic.

---

## 6. UPGRADE EVENT

**Tracking Method:** Payment Webhook (Automatic)  
**Reliability:** Highest

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         UPGRADE TRACKING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. User upgrades plan in customer's app                                    │
│                                                                              │
│  2. Customer's backend updates Stripe subscription:                         │
│     stripe.subscriptions.update(subscriptionId, {                           │
│       items: [{ price: 'price_higher_tier' }]                               │
│     });                                                                     │
│                                                                              │
│  3. Stripe sends webhook:                                                   │
│     Event: customer.subscription.updated                                    │
│     {                                                                       │
│       "type": "customer.subscription.updated",                              │
│       "data": {                                                             │
│         "object": {                                                         │
│           "id": "sub_xxx",                                                  │
│           "customer": "cus_xxx",                                            │
│           "items": [{ "price": { "id": "price_higher_tier" } }]             │
│         },                                                                  │
│         "previous_attributes": {                                            │
│           "items": [{ "price": { "id": "price_lower_tier" } }]              │
│         }                                                                   │
│       }                                                                     │
│     }                                                                       │
│                                                                              │
│  4. Our handler:                                                            │
│     ├── Compare current price vs previous_attributes.price                  │
│     ├── Lookup price amounts to determine direction                         │
│     ├── If new_amount > old_amount → UPGRADE                                │
│     ├── If referral exists with active rewards:                             │
│     │   ├── Recalculate reward based on new amount                          │
│     │   └── Update recurring reward base                                    │
│     └── Record upgrade event for analytics                                  │
│                                                                              │
│  FULLY AUTOMATIC - No customer code                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Customer Integration

**None required** - We detect upgrades from Stripe subscription changes.

---

## 7. DOWNGRADE EVENT

**Tracking Method:** Payment Webhook (Automatic)  
**Reliability:** Highest

### How It Works

Same as upgrade, but:
- new_amount < old_amount → DOWNGRADE
- We adjust recurring reward base downward
- Record for analytics (may indicate churn risk)

### Customer Integration

**None required**

---

## 8. CHURN EVENT

**Tracking Method:** Payment Webhook (Automatic)  
**Reliability:** Highest

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CHURN TRACKING FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Stripe sends webhook:                                                      │
│  Event: customer.subscription.deleted                                       │
│  {                                                                          │
│    "type": "customer.subscription.deleted",                                 │
│    "data": {                                                                │
│      "object": {                                                            │
│        "id": "sub_xxx",                                                     │
│        "customer": "cus_xxx",                                               │
│        "canceled_at": 1705312800,                                           │
│        "cancellation_details": {                                            │
│          "reason": "payment_failed"  // or "customer_request"               │
│        }                                                                    │
│      }                                                                      │
│    }                                                                        │
│  }                                                                          │
│                                                                              │
│  Our handler:                                                               │
│  ├── Lookup referral by subscription                                        │
│  ├── Update referral status: converted → churned                            │
│  ├── Stop future recurring rewards                                          │
│  ├── Record churn for analytics                                             │
│  └── Calculate referrer's churn rate (for fraud/quality scoring)            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Customer Integration

**None required**

---

## 9. REFUND EVENT

**Tracking Method:** Payment Webhook (Automatic)  
**Reliability:** Highest

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          REFUND TRACKING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Stripe sends webhook:                                                      │
│  Event: charge.refunded                                                     │
│  {                                                                          │
│    "type": "charge.refunded",                                               │
│    "data": {                                                                │
│      "object": {                                                            │
│        "id": "ch_xxx",                                                      │
│        "customer": "cus_xxx",                                               │
│        "amount_refunded": 9900,                                             │
│        "refunded": true                                                     │
│      }                                                                      │
│    }                                                                        │
│  }                                                                          │
│                                                                              │
│  Our handler:                                                               │
│  ├── Find referral/reward by charge or customer                             │
│  ├── If reward not yet paid out:                                            │
│  │   └── Cancel reward                                                      │
│  ├── If reward already paid:                                                │
│  │   ├── Create adjustment record                                           │
│  │   ├── Deduct from referrer balance                                       │
│  │   └── Notify referrer of clawback                                        │
│  └── Update referral status                                                 │
│                                                                              │
│  Policy: Full refund within X days = full reward clawback                   │
│          Partial refund = proportional adjustment                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Customer Integration

**None required**

---

# Integration Summary

## What Customer Needs to Do

### Minimal Integration (Click + Invitations Only)

```html
<!-- Just add this to every page -->
<script src="https://sdk.referralapp.io/v1.js" data-tenant="ten_xxx"></script>
```

**Tracks:** Clicks, widget views, invitation sends  
**Doesn't track:** Signups, conversions

---

### Standard Integration (Full Tracking)

**Step 1: Add SDK (2 minutes)**
```html
<script src="https://sdk.referralapp.io/v1.js" data-tenant="ten_xxx"></script>
```

**Step 2: Track Signups (30 minutes)**
```javascript
// Backend: After creating user
await referralApp.track.signup({
  email: user.email,
  externalUserId: user.id,
  visitorId: req.body.visitorId,
  referralCode: req.body.referralCode
});
```

**Step 3: Connect Stripe (5 minutes)**
- OAuth connect in dashboard
- Add metadata to Stripe Customer:
```javascript
metadata: {
  referralapp_referral_id: referralResponse.referral_id
}
```

**Total: ~1-2 hours developer time**

---

### Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE DATA FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CLICK                                                                      │
│  ─────                                                                      │
│  Referral Link → Our Redirect Server → Cookie on Client Site               │
│                                                                              │
│  SIGNUP                                                                     │
│  ──────                                                                     │
│  Frontend (cookie) → Customer Backend → Our API                             │
│                     ↓                                                        │
│              [email, visitor_id, referral_code]                             │
│                                                                              │
│  CONVERSION                                                                 │
│  ──────────                                                                 │
│  Customer Backend → Stripe → Webhook → Our API                              │
│                    ↓                                                         │
│             [metadata.referral_id]                                          │
│                                                                              │
│  RENEWAL / UPGRADE / DOWNGRADE / CHURN / REFUND                             │
│  ──────────────────────────────────────────────                             │
│  Stripe → Webhook → Our API (fully automatic)                               │
│                                                                              │
│  INVITATIONS                                                                │
│  ───────────                                                                │
│  Widget UI → SDK → Our API (fully automatic)                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# Attribution Logic

## When Attribution Happens

Attribution (matching visitor to referrer) happens at **signup time**, NOT at conversion time.

```
Click → [Cookie stored] → ... days pass ... → Signup → ATTRIBUTION
                                                      ↓
                                              Match visitor_id to click
                                              Get referrer_id, campaign_id
                                              Validate campaign still valid
                                              Create Referral record

Conversion → [Later]
           ↓
           Lookup existing Referral by email/user_id
           (Attribution already done)
```

## What We Validate at Signup

| Check | Why |
|-------|-----|
| Campaign status | Paused/ended campaigns don't attribute |
| Cookie duration | Click too old = no attribution |
| Campaign grace period | Ended recently = may still honor |
| Self-referral | Same email/IP as referrer = reject |
| Fraud score | AI agent flags suspicious patterns |
| Referrer status | Blocked referrer = no attribution |

## What We Validate at Conversion

| Check | Why |
|-------|-----|
| Referral exists | Must have attributed signup first |
| Referral not already converted | No double rewards |
| Payment is real | Stripe confirms funds |
| Within reward rules | Caps, limits, eligibility |

---

**Document Version:** 2.0  
**Created:** December 2024  
**Updated:** December 2024  

## Changes in v2.0

| Change | Description |
|--------|-------------|
| Added Glossary | Definitions for visitor, referrer, referee, attribution, IP hash, referer URL |
| SDK Architecture | Clarified SDK code (static) vs Campaign config (dynamic) |
| A/B Testing & Segmentation | How it works, who controls what |
| Campaign State Handling | SDK behavior for paused/ended campaigns |
| Widget Referrer ID | Customer MUST pass user identity during init |
| Alternative Integration | Segment, auth webhooks, Zapier - no backend code options |
| Auth Provider Integration | Keycloak, Zitadel, Auth0 webhook patterns |
| AI Integration Assistance | What AI can/cannot help with |
| Confirmed vs Unconfirmed | Recommendation to track confirmed only |
| Cookie Alternatives | Email matching as lowest-friction option |
