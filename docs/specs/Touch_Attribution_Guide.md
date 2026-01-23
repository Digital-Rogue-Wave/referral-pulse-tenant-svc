# 🎯 Touch Attribution Models
## Complete Guide for Referral Marketing

**Version:** 1.0  
**Created:** December 2024  
**Purpose:** Technical and conceptual reference for attribution implementation

---

# 📋 Table of Contents

1. [What is Attribution?](#what-is-attribution)
2. [The Core Problem](#the-core-problem)
3. [Attribution Models Explained](#attribution-models-explained)
4. [Technical Implementation](#technical-implementation)
5. [Real-World Scenarios](#real-world-scenarios)
6. [Decision Guide](#decision-guide)
7. [Common Misconceptions](#common-misconceptions)

---

# 1️⃣ What is Attribution?

## Definition

**Attribution** is the process of determining which referrer should receive credit (and reward) when a prospect converts into a customer.

## The Simple Case (90% of referrals)

```
John shares link → Friend clicks → Friend signs up → John gets credit ✓
```

No attribution decision needed. One referrer, one conversion.

## When Attribution Matters

Attribution becomes important when the **same prospect** interacts with **multiple referrers** before converting.

```
Day 1:  John shares link → Prospect clicks
Day 5:  Sarah shares link → Same prospect clicks
Day 10: Prospect signs up

Question: Who gets credit?
- John? (first contact)
- Sarah? (final push)
- Both? (shared credit)
```

---

# 2️⃣ The Core Problem

## Multiple Touchpoints, One Conversion

In B2B SaaS, prospects often:
- Receive recommendations from multiple people
- Research over days or weeks
- Click multiple referral links before deciding

## The Attribution Question

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    PROSPECT JOURNEY                                             │
│                                                                 │
│    Day 1        Day 5        Day 8        Day 12                │
│      │            │            │            │                   │
│      ▼            ▼            ▼            ▼                   │
│    John's      Sarah's      Mike's      CONVERTS               │
│    Link        Link         Link        (Signs up)              │
│                                                                 │
│    Who gets the €50 reward?                                     │
│                                                                 │
│    Option A: John   (first-touch)                               │
│    Option B: Mike   (last-touch)                                │
│    Option C: All 3  (multi-touch)                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

# 3️⃣ Attribution Models Explained

## Model 1: First-Touch Attribution

### Concept

**The first referrer to reach the prospect gets 100% of the credit.**

### How It Works

```
Day 1:  John's link clicked    → Cookie saved: referrer = JOHN
Day 5:  Sarah's link clicked   → Cookie unchanged (John is first)
Day 8:  Mike's link clicked    → Cookie unchanged (John is first)
Day 12: Prospect converts      → JOHN gets full credit
```

### Visual

```
John ──────●─────────────────────────────────────→ 100% Credit
           │
Sarah ─────┼────●────────────────────────────────→ 0% Credit
           │    │
Mike  ─────┼────┼────●───────────────────────────→ 0% Credit
           │    │    │
           ▼    ▼    ▼                    ▼
         Click Click Click            Conversion
         Day 1 Day 5 Day 8              Day 12
```

### Pros & Cons

| Pros | Cons |
|------|------|
| Simple to implement | Ignores later influences |
| Easy to explain | May credit inactive referrers |
| No disputes | Doesn't reward "closers" |
| Fair for discovery | May discourage follow-up |

### Best For

- Simple referral programs
- Short sales cycles
- Programs valuing awareness/discovery
- SMB SaaS products

### Code Example

```javascript
function handleReferralClick(referralCode) {
  const existingReferrer = getCookie('referrer');
  
  // Only save if this is the FIRST referrer
  if (!existingReferrer) {
    setCookie('referrer', referralCode, 90); // 90-day cookie
    trackClick(referralCode, 'first_touch');
  }
  // If cookie exists, do nothing - keep first referrer
}
```

---

## Model 2: Last-Touch Attribution

### Concept

**The last referrer before conversion gets 100% of the credit.**

### How It Works

```
Day 1:  John's link clicked    → Cookie saved: referrer = JOHN
Day 5:  Sarah's link clicked   → Cookie updated: referrer = SARAH
Day 8:  Mike's link clicked    → Cookie updated: referrer = MIKE
Day 12: Prospect converts      → MIKE gets full credit
```

### Visual

```
John ──────●─────────────────────────────────────→ 0% Credit
           │
Sarah ─────┼────●────────────────────────────────→ 0% Credit
           │    │
Mike  ─────┼────┼────●───────────────────────────→ 100% Credit
           │    │    │
           ▼    ▼    ▼                    ▼
         Click Click Click            Conversion
         Day 1 Day 5 Day 8              Day 12
```

### Pros & Cons

| Pros | Cons |
|------|------|
| Rewards the "closer" | Ignores initial discovery |
| Simple to implement | May credit opportunists |
| Good for sales-heavy | Unfair to first referrer |
| Rewards persistence | Can cause referrer conflicts |

### Best For

- Sales-driven conversions
- Long consideration cycles
- Programs valuing persuasion
- Enterprise products

### Code Example

```javascript
function handleReferralClick(referralCode) {
  // Always overwrite with the most recent referrer
  setCookie('referrer', referralCode, 90);
  trackClick(referralCode, 'last_touch');
}
```

---

## Model 3: Multi-Touch Attribution

### Concept

**Credit is distributed across all referrers who influenced the conversion.**

### Distribution Methods

#### Linear Attribution
Equal credit to all touchpoints.

```
Day 1:  John clicks
Day 5:  Sarah clicks
Day 8:  Mike clicks
Day 12: Conversion (€90 value)

Credit:
- John:  €30 (33.3%)
- Sarah: €30 (33.3%)
- Mike:  €30 (33.3%)
```

#### Time-Decay Attribution
More credit to recent touchpoints.

```
Credit (example weights):
- John:  €15 (16.7%)  ← oldest, least credit
- Sarah: €25 (27.8%)  ← middle
- Mike:  €50 (55.5%)  ← most recent, most credit
```

#### Position-Based (U-Shaped)
Most credit to first and last, less to middle.

```
Credit (40/20/40 split):
- John:  €36 (40%)  ← first touch
- Sarah: €18 (20%)  ← middle touch
- Mike:  €36 (40%)  ← last touch
```

### Visual

```
                    Linear          Time-Decay      Position-Based
                    ───────         ──────────      ──────────────
John  (first)       33.3%           16.7%           40%
Sarah (middle)      33.3%           27.8%           20%
Mike  (last)        33.3%           55.5%           40%
```

### Pros & Cons

| Pros | Cons |
|------|------|
| Most fair/complete | Complex to implement |
| Rewards all contributors | Hard to explain |
| Data-rich insights | Fractional payouts confuse |
| Good for analysis | May cause disputes |

### Best For

- Enterprise sales
- Complex B2B journeys
- Data-driven organizations
- High-value conversions

### Code Example

```javascript
function handleReferralClick(referralCode) {
  // Store ALL touchpoints
  let history = getCookie('referrer_history') || [];
  
  history.push({
    code: referralCode,
    timestamp: Date.now(),
    source: getSource()
  });
  
  setCookie('referrer_history', JSON.stringify(history), 90);
  trackClick(referralCode, 'multi_touch');
}

function attributeConversion(conversionValue, model = 'linear') {
  const history = JSON.parse(getCookie('referrer_history') || '[]');
  
  if (history.length === 0) return null;
  if (history.length === 1) {
    return [{ code: history[0].code, credit: conversionValue }];
  }
  
  switch (model) {
    case 'linear':
      return linearAttribution(history, conversionValue);
    case 'time_decay':
      return timeDecayAttribution(history, conversionValue);
    case 'position_based':
      return positionBasedAttribution(history, conversionValue);
  }
}

function linearAttribution(history, value) {
  const creditEach = value / history.length;
  return history.map(h => ({ code: h.code, credit: creditEach }));
}

function positionBasedAttribution(history, value) {
  const firstCredit = value * 0.4;
  const lastCredit = value * 0.4;
  const middleTotal = value * 0.2;
  const middleCount = history.length - 2;
  const middleEach = middleCount > 0 ? middleTotal / middleCount : 0;
  
  return history.map((h, i) => {
    if (i === 0) return { code: h.code, credit: firstCredit };
    if (i === history.length - 1) return { code: h.code, credit: lastCredit };
    return { code: h.code, credit: middleEach };
  });
}
```

---

## Model 4: Offline Conversion Tracking

### Concept

**Track conversions that happen outside the digital funnel.**

### Use Cases

- Sales calls that close deals
- In-person meetings
- Bank transfers (not through Stripe)
- Contract signatures
- Phone orders

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ONLINE JOURNEY                    OFFLINE CONVERSION           │
│                                                                 │
│  Day 1: John's link clicked        Day 15: Sales call           │
│         ↓                                   ↓                   │
│  Cookie saved: ref=JOHN            Sales rep closes deal        │
│         ↓                                   ↓                   │
│  Lead captured in CRM              Manual entry or API:         │
│  (email + ref code)                "Lead X converted, €5000"    │
│                                            ↓                    │
│                                    System matches to John       │
│                                            ↓                    │
│                                    John credited €500 (10%)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Options

#### Option A: Manual Entry

Admin manually logs conversions in dashboard:

```
┌─────────────────────────────────────────────────────────────────┐
│  Log Offline Conversion                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Customer Email: [customer@company.com    ]                     │
│  Conversion Value: [€5,000                ]                     │
│  Conversion Type: [Offline Sale      ▼]                         │
│  Notes: [Closed via sales call on 12/1    ]                     │
│                                                                 │
│  [Log Conversion]                                               │
│                                                                 │
│  ✓ Matched to referrer: John (JOHN-X7K9)                       │
│    Original click: November 15, 2024                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Option B: API Integration

```javascript
// CRM or sales tool calls your API
POST /api/v1/conversions/offline
{
  "email": "customer@company.com",
  "value": 5000,
  "currency": "EUR",
  "type": "offline_sale",
  "external_id": "deal_12345",
  "metadata": {
    "sales_rep": "Alice",
    "close_date": "2024-12-01",
    "notes": "Enterprise contract signed"
  }
}

// Response
{
  "success": true,
  "conversion_id": "conv_abc123",
  "attribution": {
    "referrer_code": "JOHN-X7K9",
    "referrer_email": "john@partner.com",
    "original_click": "2024-11-15T10:30:00Z",
    "commission_earned": 500
  }
}
```

### Matching Logic

The system tries to match offline conversions to referrals:

```
1. Match by email (primary)
   customer@company.com → Find in referral clicks → Match!

2. Match by company domain (fallback)
   @company.com → Find any clicks from company.com → Match!

3. Match by CRM ID (if integrated)
   CRM Contact ID → Lookup in synced data → Match!

4. No match found
   → Log as organic/unattributed conversion
```

---

# 4️⃣ Technical Implementation

## Cookie Strategy

### First-Touch Implementation

```javascript
// SDK Cookie Management
const ReferralAttribution = {
  
  COOKIE_NAME: '_ref_code',
  COOKIE_DAYS: 90,
  
  // Called when referral link is clicked
  captureReferral: function() {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    
    if (!refCode) return;
    
    // FIRST-TOUCH: Only save if no existing cookie
    if (!this.getCookie(this.COOKIE_NAME)) {
      this.setCookie(this.COOKIE_NAME, refCode, this.COOKIE_DAYS);
      this.setCookie('_ref_timestamp', Date.now(), this.COOKIE_DAYS);
      this.trackClick(refCode);
    }
  },
  
  // Get current referrer
  getReferrer: function() {
    return this.getCookie(this.COOKIE_NAME);
  },
  
  // Called on conversion
  trackConversion: function(data) {
    const refCode = this.getReferrer();
    if (!refCode) return;
    
    return fetch('/api/conversions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referral_code: refCode,
        ...data
      })
    });
  },
  
  // Cookie utilities
  setCookie: function(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax; Secure`;
  },
  
  getCookie: function(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }
};
```

### Last-Touch Implementation

```javascript
// Only change: Always overwrite cookie
captureReferral: function() {
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  
  if (!refCode) return;
  
  // LAST-TOUCH: Always update cookie
  this.setCookie(this.COOKIE_NAME, refCode, this.COOKIE_DAYS);
  this.setCookie('_ref_timestamp', Date.now(), this.COOKIE_DAYS);
  this.trackClick(refCode);
}
```

### Multi-Touch Implementation

```javascript
// Store history of all touchpoints
captureReferral: function() {
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  
  if (!refCode) return;
  
  // MULTI-TOUCH: Append to history
  let history = this.getCookie('_ref_history');
  history = history ? JSON.parse(history) : [];
  
  // Avoid duplicate consecutive clicks
  const lastEntry = history[history.length - 1];
  if (lastEntry && lastEntry.code === refCode) return;
  
  history.push({
    code: refCode,
    timestamp: Date.now(),
    source: document.referrer || 'direct'
  });
  
  this.setCookie('_ref_history', JSON.stringify(history), this.COOKIE_DAYS);
  this.trackClick(refCode);
}
```

## Database Schema

```sql
-- Referral clicks table
CREATE TABLE referral_clicks (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL,
  referrer_id UUID NOT NULL,
  referral_code VARCHAR(50) NOT NULL,
  prospect_email VARCHAR(255),
  prospect_fingerprint VARCHAR(255),  -- Anonymous identifier
  ip_address INET,
  user_agent TEXT,
  source VARCHAR(50),  -- 'email', 'linkedin', 'whatsapp', etc.
  landing_page TEXT,
  utm_params JSONB,
  clicked_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_referral_code (referral_code),
  INDEX idx_prospect_fingerprint (prospect_fingerprint),
  INDEX idx_clicked_at (clicked_at)
);

-- For multi-touch: touchpoint history
CREATE TABLE touchpoint_history (
  id UUID PRIMARY KEY,
  prospect_fingerprint VARCHAR(255) NOT NULL,
  referral_code VARCHAR(50) NOT NULL,
  click_id UUID REFERENCES referral_clicks(id),
  touch_order INTEGER NOT NULL,
  touched_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_prospect_history (prospect_fingerprint, touch_order)
);

-- Conversions table
CREATE TABLE conversions (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL,
  prospect_email VARCHAR(255) NOT NULL,
  conversion_type VARCHAR(50),  -- 'signup', 'trial', 'paid', 'offline'
  conversion_value DECIMAL(10,2),
  currency VARCHAR(3) DEFAULT 'EUR',
  attribution_model VARCHAR(20),  -- 'first_touch', 'last_touch', 'multi_touch'
  converted_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_prospect_email (prospect_email),
  INDEX idx_converted_at (converted_at)
);

-- Attribution records (who gets credit)
CREATE TABLE attribution_records (
  id UUID PRIMARY KEY,
  conversion_id UUID REFERENCES conversions(id),
  referrer_id UUID NOT NULL,
  referral_code VARCHAR(50) NOT NULL,
  credit_percentage DECIMAL(5,2),  -- 100.00 for single-touch, variable for multi
  credit_amount DECIMAL(10,2),
  original_click_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_conversion (conversion_id),
  INDEX idx_referrer (referrer_id)
);
```

## Attribution Service

```python
# attribution_service.py

class AttributionService:
    
    def __init__(self, model='first_touch'):
        self.model = model
    
    def attribute_conversion(self, conversion_data):
        """
        Main attribution logic.
        Returns list of (referrer_id, credit_percentage, credit_amount)
        """
        prospect_id = conversion_data['prospect_fingerprint']
        value = conversion_data['conversion_value']
        
        # Get all touchpoints for this prospect
        touchpoints = self.get_touchpoints(prospect_id)
        
        if not touchpoints:
            return None  # Organic conversion
        
        if self.model == 'first_touch':
            return self.first_touch(touchpoints, value)
        elif self.model == 'last_touch':
            return self.last_touch(touchpoints, value)
        elif self.model == 'linear':
            return self.linear(touchpoints, value)
        elif self.model == 'time_decay':
            return self.time_decay(touchpoints, value)
        elif self.model == 'position_based':
            return self.position_based(touchpoints, value)
    
    def first_touch(self, touchpoints, value):
        first = touchpoints[0]
        return [{
            'referrer_id': first['referrer_id'],
            'credit_percentage': 100.0,
            'credit_amount': value
        }]
    
    def last_touch(self, touchpoints, value):
        last = touchpoints[-1]
        return [{
            'referrer_id': last['referrer_id'],
            'credit_percentage': 100.0,
            'credit_amount': value
        }]
    
    def linear(self, touchpoints, value):
        credit_each = value / len(touchpoints)
        percentage_each = 100.0 / len(touchpoints)
        
        return [{
            'referrer_id': tp['referrer_id'],
            'credit_percentage': percentage_each,
            'credit_amount': credit_each
        } for tp in touchpoints]
    
    def time_decay(self, touchpoints, value, half_life_days=7):
        """
        More recent touchpoints get more credit.
        Uses exponential decay based on time.
        """
        import math
        
        now = datetime.now()
        weights = []
        
        for tp in touchpoints:
            days_ago = (now - tp['clicked_at']).days
            weight = math.pow(0.5, days_ago / half_life_days)
            weights.append(weight)
        
        total_weight = sum(weights)
        
        return [{
            'referrer_id': tp['referrer_id'],
            'credit_percentage': (w / total_weight) * 100,
            'credit_amount': (w / total_weight) * value
        } for tp, w in zip(touchpoints, weights)]
    
    def position_based(self, touchpoints, value, first_pct=40, last_pct=40):
        """
        40% to first, 40% to last, 20% split among middle.
        """
        middle_pct = 100 - first_pct - last_pct
        
        if len(touchpoints) == 1:
            return self.first_touch(touchpoints, value)
        
        if len(touchpoints) == 2:
            return [
                {
                    'referrer_id': touchpoints[0]['referrer_id'],
                    'credit_percentage': 50.0,
                    'credit_amount': value * 0.5
                },
                {
                    'referrer_id': touchpoints[1]['referrer_id'],
                    'credit_percentage': 50.0,
                    'credit_amount': value * 0.5
                }
            ]
        
        result = []
        middle_count = len(touchpoints) - 2
        middle_each_pct = middle_pct / middle_count
        
        for i, tp in enumerate(touchpoints):
            if i == 0:
                pct = first_pct
            elif i == len(touchpoints) - 1:
                pct = last_pct
            else:
                pct = middle_each_pct
            
            result.append({
                'referrer_id': tp['referrer_id'],
                'credit_percentage': pct,
                'credit_amount': value * (pct / 100)
            })
        
        return result
```

---

# 5️⃣ Real-World Scenarios

## Scenario 1: Simple Referral (Most Common - 90%)

```
John shares his link
    ↓
Friend clicks: myapp.com/?ref=JOHN
    ↓
Friend signs up

Result: John gets 100% credit
Attribution model: Irrelevant (only one touchpoint)
```

## Scenario 2: Viral Re-Sharing

```
John shares: myapp.com/?ref=JOHN
    ↓
Alice clicks, loves it
    ↓
Alice re-shares JOHN'S LINK on Twitter
    ↓
Bob sees Alice's tweet, clicks John's link
    ↓
Bob signs up

Result: John gets 100% credit
Why: Alice never became a referrer herself
Note: Alice is invisible to the system
```

**Key Insight:** If you want Alice to get credit, she needs to:
1. Sign up as a referrer
2. Get her own code
3. Share her own link

## Scenario 3: Multiple Registered Referrers

```
Day 1:  John emails prospect: myapp.com/?ref=JOHN
        Prospect clicks, browses, leaves
        
Day 7:  Sarah posts on LinkedIn: myapp.com/?ref=SARAH
        Same prospect clicks
        
Day 14: Prospect signs up

First-Touch Result: John gets credit
Last-Touch Result: Sarah gets credit
```

## Scenario 4: Same Referrer, Multiple Clicks

```
Day 1:  Prospect clicks John's link
Day 3:  Prospect clicks John's link again
Day 5:  Prospect clicks John's link again
Day 7:  Prospect signs up

Result: John gets credit (regardless of model)
Note: Multiple clicks from same referrer = one referrer
```

## Scenario 5: Long Sales Cycle (Enterprise)

```
Month 1, Week 1: John (sales partner) sends link
                 CTO clicks, shares with team
                 
Month 1, Week 3: Sarah (consultant) recommends product
                 CFO clicks her link
                 
Month 2, Week 2: Mike (existing customer) refers
                 CEO clicks his link
                 
Month 3: Company signs €50,000 contract

Multi-Touch (Linear):
- John: €16,666 (33.3%)
- Sarah: €16,666 (33.3%)  
- Mike: €16,666 (33.3%)

Multi-Touch (Position-Based):
- John: €20,000 (40%) - first touch
- Sarah: €10,000 (20%) - middle touch
- Mike: €20,000 (40%) - last touch
```

## Scenario 6: Offline Conversion

```
Online:
Day 1: John's link clicked
       Lead captured: cto@bigcorp.com

Offline:
Day 30: Sales team demos product
Day 45: Contract negotiation
Day 60: Signed deal (€100,000)

Process:
1. Sales logs conversion via API or dashboard
2. System matches cto@bigcorp.com to John's referral
3. John receives commission

Note: Without offline tracking, John gets nothing
despite originating the lead.
```

---

# 6️⃣ Decision Guide

## Which Model Should You Use?

### Use First-Touch When:

| Criteria | ✓ |
|----------|---|
| Simple referral program | ✓ |
| Short sales cycles (< 30 days) | ✓ |
| Want to reward discovery | ✓ |
| SMB/startup target market | ✓ |
| Limited technical resources | ✓ |
| Want to avoid disputes | ✓ |

### Use Last-Touch When:

| Criteria | ✓ |
|----------|---|
| Sales-assisted conversions | ✓ |
| Want to reward "closers" | ✓ |
| High-touch sales process | ✓ |
| Referrers actively nurture | ✓ |
| Clear decision moments | ✓ |

### Use Multi-Touch When:

| Criteria | ✓ |
|----------|---|
| Enterprise/high-value deals | ✓ |
| Long sales cycles (60+ days) | ✓ |
| Multiple stakeholders involved | ✓ |
| Partner ecosystem complexity | ✓ |
| Data analysis is priority | ✓ |
| Can handle payout complexity | ✓ |

### Use Configurable (Customer Chooses) When:

| Criteria | ✓ |
|----------|---|
| Diverse customer base | ✓ |
| Different use cases | ✓ |
| Want to offer flexibility | ✓ |
| Competitive differentiation | ✓ |

## Recommended Approach

```
MVP:           First-Touch only (simple, fair)
V1.1:          Add Last-Touch as option
V1.2+:         Consider Multi-Touch if enterprise demand
```

---

# 7️⃣ Common Misconceptions

## Misconception 1: "Attribution tracks viral sharing"

**Wrong:** Attribution doesn't track when non-referrers share links.

**Reality:** Attribution only matters when the SAME prospect clicks links from MULTIPLE registered referrers.

```
This is tracked:
John (referrer) → Prospect → Sarah (referrer) → Same Prospect

This is NOT tracked:
John (referrer) → Prospect → Prospect shares John's link → New person
                             ↑
                     Prospect isn't a referrer,
                     so they're invisible
```

## Misconception 2: "We need multi-touch from day one"

**Wrong:** Multi-touch is complex and rarely needed.

**Reality:** For B2B SaaS referrals:
- 90%+ of conversions have single touchpoint
- Multi-touch adds complexity with marginal benefit
- First-touch covers most use cases

## Misconception 3: "Last-touch is unfair"

**Not necessarily:** Last-touch rewards the person who convinced the prospect to act.

**When it makes sense:**
- Long consideration periods
- Multiple recommendation sources
- Sales-assisted conversions

## Misconception 4: "We lose data with first-touch"

**Partially true:** You can still TRACK all clicks, but only REWARD the first.

**Best practice:**
```
Track: All referrer touchpoints (for analytics)
Reward: First/last based on model (for payouts)
```

This gives you multi-touch DATA without multi-touch PAYOUTS.

---

# 📊 Summary Table

| Model | Credit Goes To | Complexity | Best For | Priority |
|-------|---------------|------------|----------|----------|
| **First-Touch** | First referrer | Low | SMB, simple programs | MVP |
| **Last-Touch** | Last referrer | Low | Sales-driven | V1.1 |
| **Linear** | All equally | High | Data analysis | V2 |
| **Time-Decay** | Recent more | High | Long cycles | V2 |
| **Position-Based** | First & last most | High | Enterprise | V2 |
| **Offline** | Original referrer | Medium | Sales teams | V2 |

---

**Document Version:** 1.0  
**Created:** December 2024  
**Author:** Product Team  
**Next Review:** Pre-launch
