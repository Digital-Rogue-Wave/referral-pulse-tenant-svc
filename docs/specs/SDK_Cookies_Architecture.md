# 🍪 SDK Cookies Architecture
## How Referral Tracking Works on Client Websites

**Version:** 1.0  
**Created:** December 2024  
**Purpose:** Technical reference for SDK cookie implementation

---

# 📋 Table of Contents

1. [Overview](#overview)
2. [Cookie Concepts](#cookie-concepts)
3. [First-Party vs Third-Party Cookies](#first-party-vs-third-party)
4. [SDK Architecture](#sdk-architecture)
5. [Campaign Status & CDN Strategy](#campaign-status-cdn)
6. [Implementation Guide](#implementation-guide)
7. [Cookie Management](#cookie-management)
8. [Privacy & Compliance](#privacy-compliance)
9. [Troubleshooting](#troubleshooting)

---

# 1️⃣ Overview

## What the SDK Does

Your JavaScript SDK is installed on your customer's website. When a visitor clicks a referral link, the SDK:

1. **Detects** the referral code in the URL
2. **Stores** it in a cookie on the customer's domain
3. **Persists** across sessions (up to 90 days)
4. **Reports** conversions back to your platform

## The Key Insight

```
Your SDK runs on: customer's website (myapp.com)
Cookie created on: customer's domain (myapp.com)
Cookie type: FIRST-PARTY ✓

This is NOT:
Your domain trying to set cookies on their domain
That would be: THIRD-PARTY ✗ (blocked by browsers)
```

## Visual Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  1. Referral Link Shared                                        │
│     https://myapp.com/signup?ref=JOHN                          │
│                                                                 │
│  2. Visitor Clicks Link                                         │
│     Browser navigates to myapp.com                              │
│                                                                 │
│  3. Customer's Page Loads                                       │
│     <script src="https://cdn.yourplatform.com/sdk.js">         │
│                                                                 │
│  4. SDK Executes on myapp.com                                   │
│     → Reads URL parameter: ref=JOHN                             │
│     → Creates cookie on myapp.com domain                        │
│     → Reports click to your backend                             │
│                                                                 │
│  5. Cookie Stored                                               │
│     Domain: myapp.com (FIRST-PARTY)                             │
│     Name: _referral_code                                        │
│     Value: JOHN                                                 │
│     Expires: 90 days                                            │
│                                                                 │
│  6. Days Later: Visitor Returns & Converts                      │
│     → SDK reads cookie                                          │
│     → Customer calls: SDK.trackConversion()                     │
│     → Your backend credits JOHN                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Complete Client Integration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 1: CLIENT CREATES CAMPAIGN                                │
│  ────────────────────────────────                               │
│                                                                 │
│  Client logs into your dashboard                                │
│  Creates campaign (via AI wizard or manual)                     │
│  Configures: rewards, widget style, emails, etc.                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 2: PLATFORM GENERATES CODE SNIPPET                        │
│  ───────────────────────────────────────                        │
│                                                                 │
│  Your platform generates:                                       │
│  • Unique API key: pk_live_abc123                               │
│  • Campaign ID: camp_xyz789                                     │
│  • Code snippet for their framework choice                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Installation                                    [Copy]  │    │
│  │                                                         │    │
│  │ <!-- Add before </body> -->                             │    │
│  │ <script                                                 │    │
│  │   src="https://cdn.yourplatform.com/sdk.js"            │    │
│  │   data-api-key="pk_live_abc123"                         │    │
│  │ ></script>                                              │    │
│  │                                                         │    │
│  │ [Vanilla JS] [React] [Vue] [Angular] [Next.js]          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 3: CLIENT ADDS SNIPPET TO THEIR WEBSITE                   │
│  ────────────────────────────────────────────                   │
│                                                                 │
│  Client's website (myapp.com):                                  │
│                                                                 │
│  <!DOCTYPE html>                                                │
│  <html>                                                         │
│    <head>...</head>                                             │
│    <body>                                                       │
│      <!-- Their app content -->                                 │
│                                                                 │
│      <!-- Your SDK -->                                          │
│      <script                                                    │
│        src="https://cdn.yourplatform.com/sdk.js"               │
│        data-api-key="pk_live_abc123"                            │
│      ></script>                                                 │
│    </body>                                                      │
│  </html>                                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 4: SDK LOADS AND INITIALIZES                              │
│  ─────────────────────────────────                              │
│                                                                 │
│  Browser loads page:                                            │
│                                                                 │
│  1. Downloads sdk.js from CDN (fast, cached globally)           │
│                                                                 │
│  2. SDK reads data-api-key attribute                            │
│                                                                 │
│  3. SDK fetches widget config from CDN:                         │
│     GET https://cdn.yourplatform.com/config/pk_live_abc123.json │
│                                                                 │
│     Response (cached at edge):                                  │
│     {                                                           │
│       "campaign_id": "camp_xyz789",                             │
│       "status": "active",                                       │
│       "widget_type": "floating",                                │
│       "position": "bottom-right",                               │
│       "colors": { "primary": "#4F46E5" },                       │
│       "texts": { "cta": "Refer a friend, earn €20" },           │
│       "cookie_days": 90,                                        │
│       ...                                                       │
│     }                                                           │
│                                                                 │
│  4. SDK checks status: "active" → proceed                       │
│                                                                 │
│  5. SDK initializes with config                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 5: SDK DOES ITS JOB                                       │
│  ────────────────────────────                                   │
│                                                                 │
│  A. REFERRAL CAPTURE                                            │
│     • Checks URL for ?ref=JOHN                                  │
│     • Saves to first-party cookie on myapp.com                  │
│     • Reports click to your API                                 │
│                                                                 │
│  B. WIDGET RENDERING                                            │
│     • Injects widget HTML/CSS into page                         │
│     • Positions based on config (floating, sidebar, inline)     │
│     • Matches client's brand colors                             │
│     • Handles open/close interactions                           │
│                                                                 │
│  C. USER INTERACTIONS                                           │
│     • Copy link button                                          │
│     • Social share buttons (LinkedIn, WhatsApp, Email)          │
│     • Referral history display                                  │
│     • Reward balance display                                    │
│                                                                 │
│  D. EVENT TRACKING                                              │
│     • Widget opened/closed                                      │
│     • Link copied                                               │
│     • Social share clicked                                      │
│     • Sends to: POST api.yourplatform.com/events                │
│                                                                 │
│  E. CONVERSION TRACKING                                         │
│     • Client calls: ReferralSDK.trackConversion({...})          │
│     • SDK reads cookie, sends to your API                       │
│     • Your backend validates campaign is still active           │
│     • Your backend credits the referrer                         │
│                                                                 │
│  F. GDPR INTEGRATION                                            │
│     • Waits for consent before setting cookies                  │
│     • Integrates with client's consent manager                  │
│     • Provides clearAllData() method                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Widget Integration Options

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  INTEGRATION OPTIONS                                            │
│                                                                 │
│  1. FLOATING WIDGET (default)                                   │
│     • Button in corner of screen                                │
│     • Opens modal on click                                      │
│     • No code changes needed beyond snippet                     │
│                                                                 │
│  2. INLINE WIDGET                                               │
│     • Client adds: <div id="referral-widget"></div>             │
│     • SDK renders widget inside that div                        │
│     • Client controls placement                                 │
│                                                                 │
│  3. SIDEBAR INTEGRATION                                         │
│     • Client adds container in their sidebar                    │
│     • SDK fills the container                                   │
│                                                                 │
│  4. PROGRAMMATIC (headless)                                     │
│     • No automatic widget                                       │
│     • Client builds own UI                                      │
│     • Uses SDK methods: getReferralLink(), trackConversion()    │
│                                                                 │
│  5. LANDING PAGE                                                │
│     • Hosted by you: refer.yourplatform.com/clientname/JOHN     │
│     • Or custom domain: refer.clientapp.com/JOHN                │
│     • SDK not needed, you control the page                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## How Competitors Do It

| Competitor | SDK Delivery | Config Source |
|------------|--------------|---------------|
| **Rewardful** | CDN script tag | API call on load |
| **FirstPromoter** | CDN script tag | API call on load |
| **Cello** | CDN script tag | CDN-cached config |
| **ReferralCandy** | CDN script tag | API call on load |
| **Your Platform** | CDN script tag | CDN-cached config ✓ |

---

# 2️⃣ Cookie Concepts

## What is a Cookie?

A small piece of data stored by the browser, associated with a specific domain.

```javascript
// Setting a cookie
document.cookie = "name=value; expires=...; path=/; ...";

// Result: Browser stores this data for the current domain
```

## Cookie Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| **Name** | Identifier | `_referral_code` |
| **Value** | The data | `JOHN-X7K9` |
| **Domain** | Which domain owns it | `myapp.com` |
| **Path** | Which paths can access | `/` (all paths) |
| **Expires/Max-Age** | When it's deleted | 90 days |
| **Secure** | HTTPS only | `Secure` |
| **SameSite** | Cross-site behavior | `Lax` |
| **HttpOnly** | JS can't access | Not set (we need JS access) |

## Cookie Example

```
_referral_code=JOHN-X7K9; 
Domain=myapp.com; 
Path=/; 
Expires=Sun, 04 Mar 2025 12:00:00 GMT; 
SameSite=Lax; 
Secure
```

---

# 3️⃣ First-Party vs Third-Party Cookies

## The Critical Difference

### First-Party Cookies ✅

```
User visits: myapp.com
Cookie set by: JavaScript on myapp.com
Cookie domain: myapp.com

→ Browser sees this as myapp.com's own cookie
→ ALLOWED by all browsers
→ Not affected by tracking prevention
```

### Third-Party Cookies ❌

```
User visits: myapp.com
Cookie set by: iframe/request from tracker.com
Cookie domain: tracker.com

→ Browser sees this as tracking
→ BLOCKED by Safari, Firefox
→ Being phased out in Chrome
```

## Why Your SDK Uses First-Party Cookies

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  YOUR SDK (cdn.yourplatform.com/sdk.js)                        │
│                                                                 │
│  Is LOADED from your CDN, but...                                │
│  EXECUTES in the context of myapp.com                           │
│                                                                 │
│  When it runs:                                                  │
│    document.cookie = "_referral_code=JOHN"                      │
│                                                                 │
│  The browser interprets this as:                                │
│    "myapp.com is setting its own cookie"                        │
│                                                                 │
│  Result: First-party cookie on myapp.com ✓                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Industry Standard

All major analytics and tracking tools work this way:

| Tool | SDK Source | Cookie Domain |
|------|------------|---------------|
| Google Analytics | google.com | Customer's domain |
| Segment | segment.com | Customer's domain |
| Mixpanel | mixpanel.com | Customer's domain |
| Intercom | intercom.io | Customer's domain |
| **Your Platform** | yourplatform.com | Customer's domain |

---

# 4️⃣ SDK Architecture

## Complete SDK Structure

```javascript
/**
 * Referral Platform SDK
 * Tracks referrals via first-party cookies
 */
(function(window, document) {
  'use strict';
  
  // ============================================
  // CONFIGURATION
  // ============================================
  
  const SDK = {
    // Cookie settings
    COOKIE_PREFIX: '_ref_',
    COOKIE_DAYS: 90,
    
    // API endpoints
    API_BASE: 'https://api.yourplatform.com/v1',
    
    // Customer config (set during init)
    config: {
      apiKey: null,
      cookieDomain: null,  // Optional: for cross-subdomain
      debug: false
    },
    
    // ============================================
    // INITIALIZATION
    // ============================================
    
    init: function(options) {
      this.config = { ...this.config, ...options };
      
      if (!this.config.apiKey) {
        console.error('[ReferralSDK] API key required');
        return;
      }
      
      this.log('SDK initialized');
      
      // Check for referral in URL
      this.captureReferral();
      
      // Listen for SPA navigation
      this.setupSPAListener();
    },
    
    // ============================================
    // REFERRAL CAPTURE
    // ============================================
    
    captureReferral: function() {
      const refCode = this.getUrlParam('ref') || this.getUrlParam('referral');
      
      if (!refCode) {
        this.log('No referral code in URL');
        return;
      }
      
      this.log('Referral code found:', refCode);
      
      // First-touch: only save if no existing referrer
      const existingRef = this.getCookie('code');
      
      if (existingRef) {
        this.log('Existing referrer preserved:', existingRef);
        return;
      }
      
      // Save referral data
      this.setCookie('code', refCode);
      this.setCookie('timestamp', Date.now());
      this.setCookie('landing', window.location.pathname);
      this.setCookie('source', document.referrer || 'direct');
      
      // Report click to backend
      this.trackClick(refCode);
      
      this.log('Referral saved:', refCode);
    },
    
    // ============================================
    // CLICK TRACKING
    // ============================================
    
    trackClick: function(refCode) {
      const data = {
        referral_code: refCode,
        landing_page: window.location.href,
        referrer: document.referrer,
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString()
      };
      
      // Use sendBeacon for reliability (doesn't block page)
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          `${this.API_BASE}/clicks`,
          JSON.stringify(data)
        );
      } else {
        // Fallback to fetch
        fetch(`${this.API_BASE}/clicks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey
          },
          body: JSON.stringify(data),
          keepalive: true
        }).catch(err => this.log('Click tracking error:', err));
      }
    },
    
    // ============================================
    // CONVERSION TRACKING
    // ============================================
    
    trackConversion: function(eventData) {
      const refCode = this.getCookie('code');
      
      if (!refCode) {
        this.log('No referral to attribute');
        return Promise.resolve({ attributed: false });
      }
      
      const data = {
        referral_code: refCode,
        event_type: eventData.type || 'conversion',
        event_value: eventData.value,
        currency: eventData.currency || 'EUR',
        customer_email: eventData.email,
        customer_id: eventData.customerId,
        metadata: eventData.metadata || {},
        original_timestamp: this.getCookie('timestamp'),
        original_landing: this.getCookie('landing')
      };
      
      return fetch(`${this.API_BASE}/conversions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify(data)
      })
      .then(response => response.json())
      .then(result => {
        this.log('Conversion tracked:', result);
        return result;
      })
      .catch(err => {
        this.log('Conversion error:', err);
        throw err;
      });
    },
    
    // Convenience methods for common events
    trackSignup: function(data) {
      return this.trackConversion({ type: 'signup', ...data });
    },
    
    trackTrial: function(data) {
      return this.trackConversion({ type: 'trial_start', ...data });
    },
    
    trackPurchase: function(data) {
      return this.trackConversion({ type: 'purchase', ...data });
    },
    
    // ============================================
    // COOKIE MANAGEMENT
    // ============================================
    
    setCookie: function(name, value, days) {
      days = days || this.COOKIE_DAYS;
      
      const expires = new Date();
      expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
      
      let cookieString = `${this.COOKIE_PREFIX}${name}=${encodeURIComponent(value)}`;
      cookieString += `; expires=${expires.toUTCString()}`;
      cookieString += '; path=/';
      
      // Optional: cross-subdomain support
      if (this.config.cookieDomain) {
        cookieString += `; domain=${this.config.cookieDomain}`;
      }
      
      // Security settings
      cookieString += '; SameSite=Lax';
      
      if (window.location.protocol === 'https:') {
        cookieString += '; Secure';
      }
      
      document.cookie = cookieString;
    },
    
    getCookie: function(name) {
      const fullName = this.COOKIE_PREFIX + name;
      const match = document.cookie.match(
        new RegExp('(^| )' + fullName + '=([^;]+)')
      );
      return match ? decodeURIComponent(match[2]) : null;
    },
    
    deleteCookie: function(name) {
      const fullName = this.COOKIE_PREFIX + name;
      document.cookie = `${fullName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    },
    
    clearAllCookies: function() {
      ['code', 'timestamp', 'landing', 'source'].forEach(name => {
        this.deleteCookie(name);
      });
      this.log('All referral cookies cleared');
    },
    
    // ============================================
    // STORAGE FALLBACK (localStorage)
    // ============================================
    
    // Some users block cookies, use localStorage as fallback
    setStorage: function(key, value) {
      try {
        localStorage.setItem(this.COOKIE_PREFIX + key, JSON.stringify({
          value: value,
          expires: Date.now() + (this.COOKIE_DAYS * 24 * 60 * 60 * 1000)
        }));
        return true;
      } catch (e) {
        return false;
      }
    },
    
    getStorage: function(key) {
      try {
        const item = localStorage.getItem(this.COOKIE_PREFIX + key);
        if (!item) return null;
        
        const data = JSON.parse(item);
        if (Date.now() > data.expires) {
          localStorage.removeItem(this.COOKIE_PREFIX + key);
          return null;
        }
        return data.value;
      } catch (e) {
        return null;
      }
    },
    
    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    
    getUrlParam: function(param) {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get(param);
    },
    
    setupSPAListener: function() {
      // Handle SPA navigation (React Router, Vue Router, etc.)
      let lastUrl = window.location.href;
      
      const checkUrl = () => {
        if (window.location.href !== lastUrl) {
          lastUrl = window.location.href;
          this.captureReferral();
        }
      };
      
      // Listen for history changes
      window.addEventListener('popstate', checkUrl);
      
      // Intercept pushState/replaceState
      const originalPushState = history.pushState;
      history.pushState = function() {
        originalPushState.apply(this, arguments);
        checkUrl();
      };
    },
    
    // Get current referral info (for display in UI)
    getReferralInfo: function() {
      return {
        code: this.getCookie('code'),
        timestamp: this.getCookie('timestamp'),
        landing: this.getCookie('landing'),
        source: this.getCookie('source')
      };
    },
    
    // Check if visitor was referred
    isReferred: function() {
      return !!this.getCookie('code');
    },
    
    log: function(...args) {
      if (this.config.debug) {
        console.log('[ReferralSDK]', ...args);
      }
    }
  };
  
  // ============================================
  // EXPOSE TO GLOBAL SCOPE
  // ============================================
  
  window.ReferralSDK = SDK;
  
  // Auto-initialize if data attribute present
  const script = document.currentScript;
  if (script && script.dataset.apiKey) {
    SDK.init({
      apiKey: script.dataset.apiKey,
      debug: script.dataset.debug === 'true'
    });
  }
  
})(window, document);
```

---

# 5️⃣ Campaign Status & CDN Strategy

## The Problem: How Does SDK Know Campaign Is Active?

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  SCENARIO                                                       │
│                                                                 │
│  Monday 9:00 AM:  Campaign is ACTIVE                            │
│                   Widget showing to all users ✓                 │
│                                                                 │
│  Monday 2:00 PM:  Admin PAUSES campaign                         │
│                   (budget reached, or promotion ended)          │
│                                                                 │
│  Monday 2:01 PM:  User loads page                               │
│                   Should widget show? NO                        │
│                                                                 │
│  HOW DOES SDK KNOW?                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Solution: CDN Cache + Invalidation

**NOT using SSE/WebSocket to millions of browsers.** That would be insane and unnecessary.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  THE ARCHITECTURE                                               │
│                                                                 │
│                                                                 │
│  ┌──────────────┐                                               │
│  │    ADMIN     │                                               │
│  │  DASHBOARD   │                                               │
│  └──────┬───────┘                                               │
│         │                                                       │
│         │ 1. Admin pauses campaign                              │
│         ▼                                                       │
│  ┌──────────────┐                                               │
│  │  YOUR API    │                                               │
│  │   SERVER     │                                               │
│  └──────┬───────┘                                               │
│         │                                                       │
│         │ 2. Server updates database                            │
│         │ 3. Server INVALIDATES CDN cache for this config       │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐                                               │
│  │     CDN      │  Config files cached at edge                  │
│  │ (CloudFlare) │  /config/pk_live_abc123.json                  │
│  └──────┬───────┘                                               │
│         │                                                       │
│         │ 4. Old cached config PURGED                           │
│         │ 5. Next request gets FRESH config from origin         │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐                                               │
│  │   END USER   │                                               │
│  │   BROWSER    │                                               │
│  └──────────────┘                                               │
│         │                                                       │
│         │ 6. User loads page                                    │
│         │ 7. SDK fetches config from CDN                        │
│         │ 8. Gets NEW config with status: "paused"              │
│         │ 9. SDK does NOT show widget                           │
│         │                                                       │
│         ▼                                                       │
│      NO WIDGET SHOWN ✓                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## The Config File Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  CDN CACHED CONFIG: /config/pk_live_abc123.json                 │
│                                                                 │
│  {                                                              │
│    "campaign_id": "camp_xyz789",                                │
│    "status": "active",        ← KEY FIELD                       │
│    "widget_type": "floating",                                   │
│    "colors": {...},                                             │
│    "texts": {...},                                              │
│    "rewards": {...},                                            │
│    "valid_until": "2024-12-31T23:59:59Z",  ← Optional end date  │
│    "config_version": 42       ← For cache busting               │
│  }                                                              │
│                                                                 │
│  POSSIBLE STATUS VALUES:                                        │
│  • "active"    → Show widget, track referrals                   │
│  • "paused"    → Hide widget, still track existing cookies      │
│  • "ended"     → Hide widget, stop all tracking                 │
│  • "scheduled" → Not started yet, hide widget                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## SDK Status Check Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  SDK INITIALIZATION FLOW                                        │
│                                                                 │
│  Page Loads                                                     │
│      │                                                          │
│      ▼                                                          │
│  Fetch config from CDN                                          │
│      │                                                          │
│      ▼                                                          │
│  Check config.status                                            │
│      │                                                          │
│      ├─── "active" ───────→ Show widget                         │
│      │                      Track referrals                     │
│      │                      Track conversions                   │
│      │                                                          │
│      ├─── "paused" ───────→ Hide widget                         │
│      │                      Still read existing cookies         │
│      │                      Still track conversions             │
│      │                      (honor existing referrals)          │
│      │                                                          │
│      ├─── "ended" ────────→ Hide widget                         │
│      │                      Stop all tracking                   │
│      │                      Clear cookies (optional)            │
│      │                                                          │
│      └─── "scheduled" ────→ Check valid_from date               │
│                             Hide until start date               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Update Timing

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  TIMELINE AFTER ADMIN PAUSES CAMPAIGN                           │
│                                                                 │
│  T+0s      Admin clicks "Pause Campaign"                        │
│      │                                                          │
│  T+1s      Your server updates database                         │
│      │     Your server calls CDN purge API                      │
│      │                                                          │
│  T+2-5s    CDN purges cached config globally                    │
│      │     (CloudFlare: ~2-5 seconds worldwide)                 │
│      │                                                          │
│  T+5s+     All NEW page loads get fresh config                  │
│            Widget hidden for new visitors                       │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  USERS ALREADY ON PAGE:                                         │
│  • They still see widget (page already loaded)                  │
│  • Next page load/refresh → widget disappears                   │
│  • Acceptable delay: seconds to minutes                         │
│                                                                 │
│  THIS IS NORMAL AND ACCEPTABLE FOR B2B SAAS                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## CDN Cache Strategy Options

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  OPTION A: PURGE ON CHANGE (Recommended)                        │
│  ────────────────────────────────────────                       │
│                                                                 │
│  • Config cached indefinitely at CDN                            │
│  • When admin changes anything → purge cache                    │
│  • Next request fetches fresh from your server                  │
│  • Server regenerates config, CDN caches again                  │
│                                                                 │
│  Pros: Fast reads, instant updates when needed                  │
│  Cons: Requires CDN purge API integration                       │
│                                                                 │
│  Best for: Your use case ✓                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  OPTION B: SHORT TTL                                            │
│  ───────────────────                                            │
│                                                                 │
│  • Config cached for 5-15 minutes                               │
│  • Automatically refreshes after TTL                            │
│  • No purge needed                                              │
│                                                                 │
│  Pros: Simple, no purge logic                                   │
│  Cons: Up to 15 min delay for changes                           │
│                                                                 │
│  Acceptable for: Non-critical updates                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  OPTION C: HYBRID (Best Practice)                               │
│  ────────────────────────────────                               │
│                                                                 │
│  • Long cache (1 hour) for normal operation                     │
│  • Purge on CRITICAL changes:                                   │
│    - Campaign paused/ended                                      │
│    - Campaign started                                           │
│    - Major config changes                                       │
│  • Let TTL handle minor changes:                                │
│    - Text tweaks                                                │
│    - Color adjustments                                          │
│                                                                 │
│  Best balance of performance and freshness ✓                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Handling Users Mid-Session

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  SCENARIO: User has page open when campaign pauses              │
│                                                                 │
│  Options:                                                       │
│                                                                 │
│  1. DO NOTHING (Simplest - Recommended for MVP)                 │
│     • User sees widget until page refresh                       │
│     • If they submit referral, backend validates                │
│     • Backend rejects if campaign paused                        │
│     • Shows user friendly message                               │
│                                                                 │
│  2. PERIODIC REFRESH (V1.1)                                     │
│     • SDK re-fetches config every 30-60 minutes                 │
│     • Not real-time, but catches long sessions                  │
│     • Still just HTTP GET, not persistent connection            │
│                                                                 │
│  3. VALIDATE ON ACTION (Recommended)                            │
│     • SDK shows widget based on cached config                   │
│     • When user SUBMITS referral → API validates                │
│     • API checks current campaign status                        │
│     • Returns error if campaign no longer active                │
│     • SDK shows: "This promotion has ended"                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Complete Status Check Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  COMPLETE FLOW                                                  │
│                                                                 │
│                                                                 │
│  ADMIN SIDE                         USER SIDE                   │
│  ──────────                         ─────────                   │
│                                                                 │
│  Admin Dashboard                    User's Browser              │
│       │                                  │                      │
│       │ Pause Campaign                   │ Load Page            │
│       ▼                                  ▼                      │
│  Your API Server ◄──────────────── CDN (Config Cache)           │
│       │                                  │                      │
│       │ 1. Update DB                     │ Fetch config         │
│       │ 2. Purge CDN                     │                      │
│       │                                  ▼                      │
│       │                             SDK Checks Status           │
│       │                                  │                      │
│       │                                  ├── Active? → Show     │
│       │                                  └── Paused? → Hide     │
│       │                                                         │
│       │                             User Submits Referral       │
│       │                                  │                      │
│       ▼                                  ▼                      │
│  Your API Server ◄─────────────── POST /referrals               │
│       │                                                         │
│       │ 3. Validate campaign still active                       │
│       │ 4. Accept or reject                                     │
│       │                                                         │
│       ▼                                                         │
│  Response to User                                               │
│  • Success: "Referral sent!"                                    │
│  • Or: "Sorry, this promotion has ended"                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Summary: No Real-Time Push Needed

| Layer | Responsibility | Update Speed |
|-------|----------------|--------------|
| **CDN Config** | Controls widget visibility | ~5 seconds after purge |
| **SDK** | Reads config, shows/hides widget | On page load |
| **API Backend** | Final validation on actions | Real-time |

**Key Insight:** You don't need real-time push to browsers. You need:

1. **Fast config updates** via CDN purge (~5 sec)
2. **Backend validation** as safety net (real-time)
3. **Acceptable delay** for users mid-session (they refresh or get rejected on submit)

This is exactly how competitors handle it. No SSE/WebSocket needed for end users.

---

# 6️⃣ Implementation Guide

## Customer Integration

### Basic Setup

```html
<!-- Add to customer's website, before </body> -->
<script 
  src="https://cdn.yourplatform.com/sdk.js"
  data-api-key="pk_live_abc123"
></script>
```

### Manual Initialization

```html
<script src="https://cdn.yourplatform.com/sdk.js"></script>
<script>
  ReferralSDK.init({
    apiKey: 'pk_live_abc123',
    debug: true  // Enable for development
  });
</script>
```

### Tracking Conversions

```javascript
// When user signs up
ReferralSDK.trackSignup({
  email: 'newuser@example.com',
  customerId: 'cust_12345'
});

// When user starts trial
ReferralSDK.trackTrial({
  email: 'newuser@example.com',
  plan: 'pro'
});

// When user makes purchase
ReferralSDK.trackPurchase({
  email: 'newuser@example.com',
  value: 99.00,
  currency: 'EUR',
  plan: 'pro_annual'
});
```

### React Integration

```jsx
// hooks/useReferral.js
import { useEffect } from 'react';

export function useReferral(apiKey) {
  useEffect(() => {
    // Load SDK
    const script = document.createElement('script');
    script.src = 'https://cdn.yourplatform.com/sdk.js';
    script.onload = () => {
      window.ReferralSDK.init({ apiKey });
    };
    document.body.appendChild(script);
    
    return () => {
      document.body.removeChild(script);
    };
  }, [apiKey]);
}

// Usage
function App() {
  useReferral('pk_live_abc123');
  
  const handleSignup = async (userData) => {
    await createUser(userData);
    
    // Track referral conversion
    window.ReferralSDK?.trackSignup({
      email: userData.email,
      customerId: userData.id
    });
  };
  
  return <SignupForm onSubmit={handleSignup} />;
}
```

### Vue Integration

```javascript
// plugins/referral.js
export default {
  install(app, options) {
    const script = document.createElement('script');
    script.src = 'https://cdn.yourplatform.com/sdk.js';
    script.onload = () => {
      window.ReferralSDK.init({ apiKey: options.apiKey });
      app.config.globalProperties.$referral = window.ReferralSDK;
    };
    document.body.appendChild(script);
  }
};

// main.js
import ReferralPlugin from './plugins/referral';
app.use(ReferralPlugin, { apiKey: 'pk_live_abc123' });

// Component usage
export default {
  methods: {
    onSignup(user) {
      this.$referral.trackSignup({
        email: user.email
      });
    }
  }
}
```

---

# 7️⃣ Cookie Management

## Cookie Naming Convention

```
Prefix: _ref_

Cookies created:
- _ref_code      → Referral code (e.g., "JOHN-X7K9")
- _ref_timestamp → When referral was captured (Unix timestamp)
- _ref_landing   → Landing page path
- _ref_source    → Traffic source (referrer URL)
```

## Cross-Subdomain Tracking

If customer has multiple subdomains:

```
app.mysite.com
www.mysite.com
dashboard.mysite.com
```

Configure SDK for parent domain:

```javascript
ReferralSDK.init({
  apiKey: 'pk_live_abc123',
  cookieDomain: '.mysite.com'  // Note the leading dot
});
```

Result:

```
Cookie: _ref_code=JOHN
Domain: .mysite.com  ← Accessible from all subdomains
```

## Cookie Lifetime

```
Default: 90 days

Day 0:  Click → Cookie set, expires Day 90
Day 30: User returns → Cookie still valid
Day 89: User signs up → Attribution works ✓
Day 91: User signs up → Cookie expired, no attribution ✗
```

### Configurable Expiration

```javascript
// In SDK configuration (your backend)
{
  "campaign_id": "camp_123",
  "cookie_days": 30  // 30-day attribution window
}
```

## localStorage Fallback

Some privacy tools block cookies. The SDK should fallback:

```javascript
captureReferral: function() {
  const refCode = this.getUrlParam('ref');
  if (!refCode) return;
  
  // Try cookie first
  try {
    this.setCookie('code', refCode);
    
    // Verify it was set
    if (!this.getCookie('code')) {
      throw new Error('Cookie blocked');
    }
  } catch (e) {
    // Fallback to localStorage
    this.setStorage('code', refCode);
    this.log('Using localStorage fallback');
  }
}
```

---

# 8️⃣ Privacy & Compliance

## GDPR Considerations

Your customers are the data controllers. They must:

1. **Get consent** before loading tracking scripts
2. **Disclose** referral tracking in privacy policy
3. **Allow opt-out** and data deletion

### Integration with Consent Management

```javascript
// Customer implements consent check
document.addEventListener('DOMContentLoaded', function() {
  // Only init after consent
  if (hasUserConsent('marketing')) {
    ReferralSDK.init({ apiKey: 'pk_live_abc123' });
  }
});

// Or using OneTrust/Cookiebot
OptanonWrapper = function() {
  if (OnetrustActiveGroups.includes('C0004')) { // Marketing cookies
    ReferralSDK.init({ apiKey: 'pk_live_abc123' });
  }
};
```

### Respecting Global Privacy Control

```javascript
init: function(options) {
  // Check for GPC signal
  if (navigator.globalPrivacyControl) {
    this.log('GPC detected - tracking disabled');
    return;
  }
  
  // Normal initialization
  // ...
}
```

## Data Collected

Document what your SDK collects:

| Data | Purpose | Retention |
|------|---------|-----------|
| Referral code | Attribution | 90 days (cookie) |
| Landing page | Analytics | 90 days |
| Referrer URL | Source tracking | 90 days |
| IP address | Fraud prevention | 30 days |
| User agent | Analytics | 30 days |

## GDPR Data Requests

Provide API for data subject requests:

```javascript
// Customer can call this for GDPR deletion
ReferralSDK.clearAllCookies();

// Or via API for full data deletion
POST /api/v1/gdpr/delete
{
  "email": "user@example.com",
  "request_type": "deletion"
}
```

---

# 9️⃣ Troubleshooting

## Common Issues

### Issue 1: Cookie Not Being Set

**Symptoms:** `getCookie()` returns null after `setCookie()`

**Causes & Solutions:**

```javascript
// 1. Check if cookies are blocked
if (!navigator.cookieEnabled) {
  console.warn('Cookies are disabled');
  // Use localStorage fallback
}

// 2. Check for Secure flag on HTTP
// Secure cookies only work on HTTPS
if (window.location.protocol !== 'https:') {
  // Remove Secure flag or warn customer
}

// 3. Check SameSite restrictions
// SameSite=Strict won't work for referral links from other sites
// Use SameSite=Lax instead
```

### Issue 2: Cookie Lost Between Pages

**Symptoms:** Cookie exists on one page but not another

**Causes & Solutions:**

```javascript
// 1. Path mismatch
// BAD: Cookie set with path=/app
// Won't be accessible on /dashboard

// GOOD: Always use path=/
document.cookie = "name=value; path=/";

// 2. Subdomain mismatch
// Cookie set on app.site.com won't work on www.site.com
// Solution: Use domain=.site.com
```

### Issue 3: SDK Not Loading

**Symptoms:** `ReferralSDK is not defined`

**Causes & Solutions:**

```html
<!-- 1. Script loading order -->
<!-- BAD: Using SDK before it loads -->
<script>
  ReferralSDK.init(...); // Error!
</script>
<script src="sdk.js"></script>

<!-- GOOD: Use after script loads -->
<script src="sdk.js"></script>
<script>
  ReferralSDK.init(...);
</script>

<!-- BETTER: Use onload or defer -->
<script src="sdk.js" onload="ReferralSDK.init({...})"></script>
```

### Issue 4: Conversions Not Attributed

**Symptoms:** Conversion tracked but no referrer credited

**Debug Steps:**

```javascript
// 1. Check if cookie exists at conversion time
console.log('Referral info:', ReferralSDK.getReferralInfo());

// 2. Check cookie in browser DevTools
// Application > Cookies > [domain]
// Look for _ref_code

// 3. Verify conversion is sent with referral code
// Network tab > Filter by /conversions
// Check request payload includes referral_code

// 4. Common cause: Customer tracking conversion before signup
// Solution: Track after user record created
async function handleSignup(data) {
  const user = await createUser(data);  // First create user
  ReferralSDK.trackSignup({             // Then track conversion
    email: data.email,
    customerId: user.id
  });
}
```

### Issue 5: SPA Navigation Not Detected

**Symptoms:** Referral captured on first page, not on SPA navigation

**Solution:** SDK includes SPA listener, but verify it's working:

```javascript
// Test in console
history.pushState({}, '', '/test?ref=TEST123');
// Check if SDK captured it

// If not working, customer may need to manually trigger
window.addEventListener('routeChange', () => {
  ReferralSDK.captureReferral();
});
```

## Debug Mode

Enable debug logging:

```javascript
ReferralSDK.init({
  apiKey: 'pk_live_abc123',
  debug: true
});

// Console output:
// [ReferralSDK] SDK initialized
// [ReferralSDK] Referral code found: JOHN-X7K9
// [ReferralSDK] Referral saved: JOHN-X7K9
```

## Testing Checklist

```
□ Referral link click sets cookie
□ Cookie persists across page refreshes
□ Cookie persists across browser sessions
□ Cookie accessible on all pages (path=/)
□ Cookie works across subdomains (if needed)
□ Conversion includes referral code
□ First-touch: second click doesn't overwrite
□ Works with customer's consent management
□ localStorage fallback works when cookies blocked
□ SPA navigation captures referrals
```

---

# 📊 Summary

## Key Points

| Concept | Detail |
|---------|--------|
| **Cookie Type** | First-party (set by SDK on customer's domain) |
| **Browser Support** | Works in all browsers (not affected by 3rd-party blocks) |
| **Default Lifetime** | 90 days |
| **Fallback** | localStorage when cookies blocked |
| **Security** | SameSite=Lax, Secure on HTTPS |
| **GDPR** | Customer responsible for consent |

## Cookie Summary

```
_ref_code      = Referral code
_ref_timestamp = Capture timestamp
_ref_landing   = Landing page
_ref_source    = Traffic source

Domain: Customer's domain (first-party)
Path: / (all pages)
Expires: 90 days
SameSite: Lax
Secure: Yes (on HTTPS)
```

---

**Document Version:** 1.0  
**Created:** December 2024  
**Author:** Engineering Team  
**Next Review:** Pre-launch
